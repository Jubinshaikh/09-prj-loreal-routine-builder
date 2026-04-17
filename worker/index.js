export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      (url.pathname === "/" ||
        url.pathname === "/api/chat" ||
        url.pathname === "/api/routine")
    ) {
      return handleChatRequest(request, env);
    }

    return jsonResponse(
      {
        error: "Not found",
      },
      404,
    );
  },
};

async function handleChatRequest(request, env) {
  try {
    const body = await request.json();
    const selectedProducts = body.selectedProducts || [];
    const generatedRoutine = body.generatedRoutine || "";
    const requestType = body.requestType || "followup";
    const conversationHistory = normalizeConversationHistory(
      body.conversationHistory || [],
    );
    const lastUserMessage = getLastUserMessage(conversationHistory);

    if (!Array.isArray(selectedProducts) || selectedProducts.length === 0) {
      return jsonResponse(
        {
          error: "At least one selected product is required.",
        },
        400,
      );
    }

    if (conversationHistory.length === 0) {
      return jsonResponse(
        {
          error: "Conversation history is required.",
        },
        400,
      );
    }

    const routineInstruction =
      requestType === "routine"
        ? "For this turn, generate a clear routine using this format: Morning:, Evening:, Tips:."
        : "For this turn, answer the user's follow-up clearly and concisely while staying grounded in previous messages.";

    const systemInstruction = `You are a helpful beauty routine assistant for L'Oreal products.
Only use the products provided in the selectedProducts JSON.
Stay relevant to skincare, haircare, makeup, fragrance, and related beauty topics.
Do not make medical claims, diagnoses, or treatment promises.
If asked for diagnosis, prescriptions, or urgent medical advice, refuse briefly and suggest consulting a licensed professional.
${routineInstruction}
Keep guidance concise, practical, and beginner-friendly.`;

    const groundingMessage = {
      role: "system",
      content: `Context you must remember for this conversation:\nSelected products JSON:\n${JSON.stringify(
        selectedProducts,
        null,
        2,
      )}\n\nGenerated routine so far:\n${generatedRoutine || "None yet."}`,
    };

    const shouldUseSearch = shouldUseWebSearch(requestType, lastUserMessage);
    const baseMessages = [
      { role: "system", content: systemInstruction },
      groundingMessage,
      ...conversationHistory,
    ];

    let assistantResult;

    if (shouldUseSearch) {
      assistantResult = await getWebSearchAssistantReply(baseMessages, env);

      if (!assistantResult) {
        assistantResult = await getStandardAssistantReply(baseMessages, env);
      }
    } else {
      assistantResult = await getStandardAssistantReply(baseMessages, env);
    }

    return jsonResponse({
      message: assistantResult.message,
      sources: assistantResult.sources,
      selectedCount: selectedProducts.length,
      usedWebSearch: shouldUseSearch && assistantResult.sources.length > 0,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "Unexpected Worker error.",
      },
      500,
    );
  }
}

async function getStandardAssistantReply(messages, env) {
  const openAiResponse = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        temperature: 0.5,
      }),
    },
  );

  if (!openAiResponse.ok) {
    const errorText = await openAiResponse.text();
    throw new Error(`OpenAI request failed: ${errorText}`);
  }

  const data = await openAiResponse.json();
  const message = data.choices?.[0]?.message?.content;

  if (!message) {
    throw new Error("No assistant reply returned by model.");
  }

  return {
    message,
    sources: [],
  };
}

async function getWebSearchAssistantReply(messages, env) {
  try {
    const responsesApiReply = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          input: messages,
          tools: [{ type: "web_search_preview" }],
          temperature: 0.4,
        }),
      },
    );

    if (!responsesApiReply.ok) {
      return null;
    }

    const responseData = await responsesApiReply.json();
    const parsedResult = parseResponsesApiOutput(responseData);

    if (!parsedResult.message) {
      return null;
    }

    return parsedResult;
  } catch (error) {
    return null;
  }
}

function parseResponsesApiOutput(data) {
  const outputItems = Array.isArray(data?.output) ? data.output : [];
  const sources = [];
  let message = "";

  outputItems.forEach((item) => {
    const contentBlocks = Array.isArray(item?.content) ? item.content : [];

    contentBlocks.forEach((block) => {
      if (!message && typeof block?.text === "string") {
        message = block.text;
      }

      const annotations = Array.isArray(block?.annotations)
        ? block.annotations
        : [];

      annotations.forEach((annotation) => {
        const title = annotation?.title || annotation?.url || "Source";
        const url = annotation?.url;

        if (typeof url === "string") {
          sources.push({ title, url });
        }
      });
    });
  });

  if (!message && typeof data?.output_text === "string") {
    message = data.output_text;
  }

  return {
    message,
    sources: dedupeAndSanitizeSources(sources),
  };
}

function dedupeAndSanitizeSources(rawSources) {
  const seenUrls = new Set();

  return rawSources.filter((source) => {
    const safeUrl = sanitizeUrl(source.url);

    if (!safeUrl || seenUrls.has(safeUrl)) {
      return false;
    }

    source.url = safeUrl;
    seenUrls.add(safeUrl);
    return true;
  });
}

function sanitizeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch (error) {
    return null;
  }
}

function shouldUseWebSearch(requestType, userMessage) {
  if (requestType === "routine") {
    return false;
  }

  const normalized = (userMessage || "").toLowerCase();

  if (!normalized) {
    return false;
  }

  const searchTriggers = [
    "latest",
    "current",
    "recent",
    "today",
    "news",
    "trend",
    "trending",
    "new launch",
    "release",
    "just announced",
    "price",
    "where to buy",
    "availability",
    "official",
    "2026",
    "2025",
  ];

  return searchTriggers.some((trigger) => normalized.includes(trigger));
}

function getLastUserMessage(history) {
  const reversedHistory = [...history].reverse();
  const lastUserEntry = reversedHistory.find(
    (message) => message.role === "user",
  );
  return lastUserEntry ? lastUserEntry.content : "";
}

function normalizeConversationHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  return rawHistory
    .filter((message) => {
      const validRole =
        message?.role === "user" || message?.role === "assistant";
      const validContent = typeof message?.content === "string";
      return validRole && validContent;
    })
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
