/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productSearchInput = document.getElementById("productSearchInput");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutineButton = document.getElementById("generateRoutine");
const userInput = document.getElementById("userInput");
const sendButton = document.getElementById("sendBtn");
const rtlToggleButton = document.getElementById("rtlToggle");
const clearSelectedButton = document.getElementById("clearSelectedBtn");

/* Update this URL after deploying your Worker */
const WORKER_URL = "https://quiet-unit-fe62.shaikhjn.workers.dev/api/chat";
const DIRECTION_STORAGE_KEY = "routineBuilderDirection";
const SELECTED_PRODUCTS_STORAGE_KEY = "routineBuilderSelectedProductIds";

/* Keep selected product IDs in memory for now (localStorage comes later) */
const selectedProductIds = new Set();
const selectedProductsMap = new Map();
let allProducts = [];
const conversationHistory = [];
let generatedRoutine = "";
let isChatLoading = false;

/* Single source of truth for filter controls */
const currentFilters = {
  category: "",
  searchText: "",
};

/* Apply direction at document level and update toggle state */
function applyDirection(direction) {
  const safeDirection = direction === "rtl" ? "rtl" : "ltr";
  document.documentElement.setAttribute("dir", safeDirection);

  if (!rtlToggleButton) {
    return;
  }

  const isRtl = safeDirection === "rtl";
  rtlToggleButton.setAttribute("aria-pressed", String(isRtl));
  rtlToggleButton.innerHTML = `
    <i class="fa-solid fa-language" aria-hidden="true"></i>
    ${isRtl ? "LTR" : "RTL"}
  `;
}

/* Restore saved direction preference, defaulting to LTR */
function initializeDirectionPreference() {
  let savedDirection = "ltr";

  try {
    const storedValue = localStorage.getItem(DIRECTION_STORAGE_KEY);
    if (storedValue === "rtl" || storedValue === "ltr") {
      savedDirection = storedValue;
    }
  } catch (error) {
    savedDirection = "ltr";
  }

  applyDirection(savedDirection);
}

/* Show initial state while products are loading */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Loading products...
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  productsContainer.innerHTML = products
    .map(
      (product) => `
    <div
      class="product-card ${selectedProductIds.has(product.id) ? "selected" : ""}"
      data-product-id="${product.id}"
      role="button"
      tabindex="0"
      aria-pressed="${selectedProductIds.has(product.id)}"
      aria-label="Select ${product.name}"
    >
      <img src="${product.image}" alt="${product.name}">
      <div class="product-content">
        <div class="product-info">
          <h3>${product.name}</h3>
          <p>${product.brand}</p>
        </div>
        <button
          type="button"
          class="description-toggle"
          aria-expanded="false"
          aria-controls="product-description-${product.id}"
        >
          Show details
        </button>
        <div
          id="product-description-${product.id}"
          class="product-description"
          hidden
        >
          ${product.description}
        </div>
      </div>
    </div>
  `,
    )
    .join("");

  attachProductCardEvents();
}

/* Add click and keyboard selection behavior to each card */
function attachProductCardEvents() {
  const cards = productsContainer.querySelectorAll(".product-card");
  const descriptionButtons = productsContainer.querySelectorAll(
    ".description-toggle",
  );

  descriptionButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleProductDescription(button);
    });

    button.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });
  });

  cards.forEach((card) => {
    card.addEventListener("click", () => {
      toggleProductSelection(card);
    });

    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleProductSelection(card);
      }
    });
  });
}

/* Expand or collapse a card's product description */
function toggleProductDescription(button) {
  const descriptionId = button.getAttribute("aria-controls");
  const descriptionElement = document.getElementById(descriptionId);
  const isExpanded = button.getAttribute("aria-expanded") === "true";

  if (isExpanded) {
    button.setAttribute("aria-expanded", "false");
    button.textContent = "Show details";
    descriptionElement.hidden = true;
  } else {
    button.setAttribute("aria-expanded", "true");
    button.textContent = "Hide details";
    descriptionElement.hidden = false;
  }
}

/* Toggle selected visual state for a product card */
function toggleProductSelection(card) {
  const productId = Number(card.dataset.productId);
  const selectedProductData = allProducts.find(
    (product) => product.id === productId,
  );

  if (selectedProductIds.has(productId)) {
    selectedProductIds.delete(productId);
    selectedProductsMap.delete(productId);
    card.classList.remove("selected");
    card.setAttribute("aria-pressed", "false");
  } else {
    selectedProductIds.add(productId);
    if (selectedProductData) {
      selectedProductsMap.set(productId, selectedProductData);
    }
    card.classList.add("selected");
    card.setAttribute("aria-pressed", "true");
  }

  renderSelectedProductsList();
  saveSelectedProductsToStorage();
}

/* Keep the Selected Products panel in sync with card selection */
function renderSelectedProductsList() {
  clearSelectedButton.disabled = selectedProductsMap.size === 0;

  if (selectedProductsMap.size === 0) {
    selectedProductsList.innerHTML = `
      <p class="selected-placeholder">No products selected yet.</p>
    `;
    return;
  }

  const selectedItemsMarkup = Array.from(selectedProductsMap.values())
    .map(
      (product) => `
        <div class="selected-product-item" data-selected-id="${product.id}">
          <div class="selected-product-text">
            <strong>${product.brand}</strong>
            <span>${product.name}</span>
          </div>
          <button
            type="button"
            class="remove-selected-btn"
            data-remove-id="${product.id}"
            aria-label="Remove ${product.name}"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
      `,
    )
    .join("");

  selectedProductsList.innerHTML = selectedItemsMarkup;
}

/* Remove one selected product from list and cards */
function removeSelectedProduct(productId) {
  if (!selectedProductIds.has(productId)) {
    return;
  }

  selectedProductIds.delete(productId);
  selectedProductsMap.delete(productId);

  const matchingCard = productsContainer.querySelector(
    `.product-card[data-product-id="${productId}"]`,
  );

  if (matchingCard) {
    matchingCard.classList.remove("selected");
    matchingCard.setAttribute("aria-pressed", "false");
  }

  renderSelectedProductsList();
  saveSelectedProductsToStorage();
}

/* Clear all selected products at once */
function clearSelectedProducts() {
  if (selectedProductIds.size === 0) {
    return;
  }

  selectedProductIds.clear();
  selectedProductsMap.clear();
  renderSelectedProductsList();
  applyFilters();
  saveSelectedProductsToStorage();
}

/* Persist selected product IDs across reloads */
function saveSelectedProductsToStorage() {
  try {
    localStorage.setItem(
      SELECTED_PRODUCTS_STORAGE_KEY,
      JSON.stringify(Array.from(selectedProductIds)),
    );
  } catch (error) {
    // Ignore storage write errors; in-memory behavior still works.
  }
}

/* Restore selected product IDs after products are loaded */
function restoreSelectedProductsFromStorage() {
  try {
    const rawValue = localStorage.getItem(SELECTED_PRODUCTS_STORAGE_KEY);
    const parsedIds = JSON.parse(rawValue || "[]");

    if (!Array.isArray(parsedIds)) {
      return;
    }

    const validIds = new Set(allProducts.map((product) => product.id));

    parsedIds.forEach((idValue) => {
      const id = Number(idValue);

      if (!validIds.has(id)) {
        return;
      }

      const product = allProducts.find((item) => item.id === id);

      if (!product) {
        return;
      }

      selectedProductIds.add(id);
      selectedProductsMap.set(id, product);
    });
  } catch (error) {
    // Ignore malformed localStorage values.
  }
}

/* Build minimal JSON payload for selected products */
function getSelectedProductsPayload() {
  return Array.from(selectedProductsMap.values()).map((product) => ({
    name: product.name,
    brand: product.brand,
    category: product.category,
    description: product.description,
  }));
}

/* Add a message to in-memory conversation state */
function addMessageToChat(role, content) {
  conversationHistory.push({
    role,
    content,
    sources: [],
  });

  renderChatMessages();
}

/* Add assistant message with optional citations */
function addAssistantMessage(content, sources = []) {
  conversationHistory.push({
    role: "assistant",
    content,
    sources,
  });

  renderChatMessages();
}

/* Allow only safe http/https links in UI citations */
function sanitizeSourceUrl(url) {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }

    return parsedUrl.toString();
  } catch (error) {
    return null;
  }
}

/* Render chat UI from conversation state */
function renderChatMessages() {
  chatWindow.innerHTML = "";

  if (conversationHistory.length === 0 && !isChatLoading) {
    chatWindow.innerHTML = `
      <div class="chat-welcome">
        Select products, click Generate Routine, then ask follow-up questions.
      </div>
    `;
    return;
  }

  conversationHistory.forEach((message) => {
    const messageElement = document.createElement("div");
    messageElement.className = `chat-message ${message.role}`;
    messageElement.textContent = message.content;
    chatWindow.appendChild(messageElement);

    if (
      message.role === "assistant" &&
      Array.isArray(message.sources) &&
      message.sources.length > 0
    ) {
      const sourcesElement = document.createElement("div");
      sourcesElement.className = "chat-sources";

      const sourcesHeading = document.createElement("p");
      sourcesHeading.className = "chat-sources-title";
      sourcesHeading.textContent = "Sources";
      sourcesElement.appendChild(sourcesHeading);

      message.sources.forEach((source) => {
        const safeUrl = sanitizeSourceUrl(source.url);

        if (!safeUrl) {
          return;
        }

        const sourceLink = document.createElement("a");
        sourceLink.className = "chat-source-link";
        sourceLink.href = safeUrl;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        sourceLink.textContent = source.title || safeUrl;
        sourcesElement.appendChild(sourceLink);
      });

      if (sourcesElement.children.length > 1) {
        chatWindow.appendChild(sourcesElement);
      }
    }
  });

  if (isChatLoading) {
    const loadingElement = document.createElement("div");
    loadingElement.className = "chat-message assistant";
    loadingElement.textContent = "Thinking...";
    chatWindow.appendChild(loadingElement);
  }

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Build complete payload sent to Worker for every turn */
function buildConversationPayload(
  currentUserMessage,
  requestType = "followup",
) {
  const selectedProducts = getSelectedProductsPayload();
  const safeHistory = [
    ...conversationHistory,
    {
      role: "user",
      content: currentUserMessage,
    },
  ].map((message) => ({
    role: message.role,
    content: message.content,
  }));

  return {
    requestType,
    selectedProducts,
    generatedRoutine,
    conversationHistory: safeHistory,
  };
}

/* Call Worker endpoint for routine generation and follow-up chat */
async function requestChatReplyFromWorker(payload) {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Worker request failed");
  }

  const data = await response.json();

  if (!data.message) {
    throw new Error("Worker response was missing message text");
  }

  return data;
}

/* Send one chat turn to Worker and store result in conversation history */
async function sendChatMessage(rawUserMessage, requestType = "followup") {
  const trimmedMessage = rawUserMessage.trim();

  if (!trimmedMessage) {
    return;
  }

  const payload = buildConversationPayload(trimmedMessage, requestType);
  addMessageToChat("user", trimmedMessage);

  isChatLoading = true;
  generateRoutineButton.disabled = true;
  sendButton.disabled = true;
  renderChatMessages();

  try {
    const workerData = await requestChatReplyFromWorker(payload);
    addAssistantMessage(workerData.message, workerData.sources || []);

    if (requestType === "routine") {
      generatedRoutine = workerData.message;
    }
  } catch (error) {
    addAssistantMessage(
      "I could not respond right now. Please try again in a moment.",
    );
  } finally {
    isChatLoading = false;
    generateRoutineButton.disabled = false;
    sendButton.disabled = false;
    renderChatMessages();
  }
}

/* Handle Generate Routine click */
generateRoutineButton.addEventListener("click", async () => {
  const selectedProducts = getSelectedProductsPayload();

  if (selectedProducts.length === 0) {
    addMessageToChat(
      "assistant",
      "Select at least one product first, then I can build your routine.",
    );
    return;
  }

  const customContext = userInput.value.trim();
  const routinePrompt = customContext
    ? `Generate my routine using my selected products and this context: ${customContext}`
    : "Generate a personalized beauty routine from my selected products.";

  userInput.value = "";
  await sendChatMessage(routinePrompt, "routine");
});

/* Return products that match current category and search text */
function getFilteredProducts() {
  const normalizedSearchText = currentFilters.searchText.trim().toLowerCase();

  return allProducts.filter((product) => {
    const matchesCategory =
      !currentFilters.category || product.category === currentFilters.category;

    if (!matchesCategory) {
      return false;
    }

    if (!normalizedSearchText) {
      return true;
    }

    const searchableFields = [
      product.name,
      product.brand,
      product.category,
      product.description,
    ]
      .join(" ")
      .toLowerCase();

    return searchableFields.includes(normalizedSearchText);
  });
}

/* Apply active filters and update products grid */
function applyFilters() {
  const filteredProducts = getFilteredProducts();

  if (filteredProducts.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message no-results-message">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <p>No products match your filters. Try another keyword or category.</p>
      </div>
    `;
    return;
  }

  displayProducts(filteredProducts);
}

/* Load products once, then render using current filters */
async function initializeProducts() {
  try {
    allProducts = await loadProducts();
    restoreSelectedProductsFromStorage();
    applyFilters();
    renderSelectedProductsList();
  } catch (error) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        Unable to load products right now. Please refresh and try again.
      </div>
    `;
  }
}

/* Update category filter state */
categoryFilter.addEventListener("change", (e) => {
  currentFilters.category = e.target.value;
  applyFilters();
});

/* Update search filter state in real time */
productSearchInput.addEventListener("input", (e) => {
  currentFilters.searchText = e.target.value;
  applyFilters();
});

/* Remove individual selected items using event delegation */
selectedProductsList.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove-selected-btn");

  if (!removeButton) {
    return;
  }

  const productId = Number(removeButton.dataset.removeId);

  if (!Number.isNaN(productId)) {
    removeSelectedProduct(productId);
  }
});

clearSelectedButton.addEventListener("click", () => {
  clearSelectedProducts();
});

/* Toggle between LTR and RTL and persist preference */
rtlToggleButton.addEventListener("click", () => {
  const currentDirection = document.documentElement.getAttribute("dir");
  const nextDirection = currentDirection === "rtl" ? "ltr" : "rtl";
  applyDirection(nextDirection);

  try {
    localStorage.setItem(DIRECTION_STORAGE_KEY, nextDirection);
  } catch (error) {
    // Ignore storage errors and continue with in-memory direction change.
  }
});

/* Chat form submission handler for follow-up turns */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const text = userInput.value.trim();

  if (!text) {
    return;
  }

  if (!generatedRoutine) {
    addMessageToChat(
      "assistant",
      "Generate a routine first, then I can answer follow-up questions with full context.",
    );
    return;
  }

  sendChatMessage(text, "followup");
  chatForm.reset();
});

renderSelectedProductsList();
renderChatMessages();
initializeDirectionPreference();
initializeProducts();
