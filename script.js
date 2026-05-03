/* ============================================================
   TANixity — app.js
   Groq API integration + all UI/chat logic.
   
   HOW TO SET UP:
   1. Get a free API key at https://console.groq.com
   2. Paste it into GROQ_API_KEY below
   3. Open index.html in your browser — done!
============================================================ */

/* ──────────────────────────────────────────────────────────
   🔑  CONFIGURATION — PASTE YOUR GROQ API KEY BELOW
────────────────────────────────────────────────────────── */
const GROQ_API_KEY  = "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"; // ← Replace with your key
const GROQ_MODEL    = "llama-3.3-70b-versatile"; // Model to use
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/* ──────────────────────────────────────────────────────────
   SYSTEM PROMPT — Customize TANixity's personality here
────────────────────────────────────────────────────────── */
const SYSTEM_PROMPT = `You are TANixity, a highly advanced, robotic AI assistant.
Your tone is precise, intelligent, and slightly futuristic — like a sci-fi command AI.
Keep answers clear, concise, and helpful. Use technical language where appropriate.`;

/* ──────────────────────────────────────────────────────────
   STATE
────────────────────────────────────────────────────────── */
const conversationHistory = []; // Maintains full chat context across turns
let   isProcessing        = false; // Prevents duplicate sends

/* ──────────────────────────────────────────────────────────
   DOM REFERENCES
────────────────────────────────────────────────────────── */
const chatWindow = document.getElementById("chat-window");
const userInput  = document.getElementById("user-input");
const sendBtn    = document.getElementById("send-btn");
const apiBanner  = document.getElementById("api-banner");
const welcomeEl  = document.getElementById("welcome");

/* ──────────────────────────────────────────────────────────
   INIT — Show warning banner if API key has not been set
────────────────────────────────────────────────────────── */
if (GROQ_API_KEY === "YOUR_GROQ_API_KEY_HERE" || !GROQ_API_KEY.trim()) {
  apiBanner.classList.add("visible");
}

/* ──────────────────────────────────────────────────────────
   AUTO-GROW TEXTAREA
   Expands the input box as the user types multiple lines.
────────────────────────────────────────────────────────── */
userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});

/* ──────────────────────────────────────────────────────────
   KEYBOARD HANDLER
   Enter → send message
   Shift + Enter → insert newline
────────────────────────────────────────────────────────── */
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

/* Send button click */
sendBtn.addEventListener("click", handleSend);

/* ──────────────────────────────────────────────────────────
   RENDER HELPERS
────────────────────────────────────────────────────────── */

/**
 * Removes the welcome/splash screen on the first message.
 */
function dismissWelcome() {
  if (welcomeEl && welcomeEl.parentNode) welcomeEl.remove();
}

/**
 * Creates and appends a chat message bubble to the window.
 * @param {string} role  - "user" or "bot"
 * @param {string} text  - Message content (can be empty for bot, filled later)
 * @returns {HTMLElement} The inner bubble div (for live text updates)
 */
function appendMessage(role, text) {
  dismissWelcome();
  const isUser = role === "user";

  // Outer wrapper (flex row)
  const wrapper = document.createElement("div");
  wrapper.className = `message ${isUser ? "user" : "bot"}`;

  // Avatar badge
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = isUser ? "YOU" : "TAX";

  // Column: label + bubble
  const body = document.createElement("div");
  body.className = "msg-body";

  const label = document.createElement("div");
  label.className = "msg-label";
  label.textContent = isUser ? "USER INPUT" : "TANIXITY";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = text;

  body.appendChild(label);
  body.appendChild(bubble);
  wrapper.appendChild(avatar);
  wrapper.appendChild(body);
  chatWindow.appendChild(wrapper);
  scrollToBottom();

  return bubble; // Returned so caller can populate it during animation
}

/**
 * Shows an animated three-dot typing indicator while waiting for the API.
 * @returns {HTMLElement} The wrapper element (so it can be removed later)
 */
function showTypingIndicator() {
  dismissWelcome();

  const wrapper = document.createElement("div");
  wrapper.className = "message bot";
  wrapper.id = "typing-msg";

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = "TAX";

  const body = document.createElement("div");
  body.className = "msg-body";

  const label = document.createElement("div");
  label.className = "msg-label";
  label.textContent = "TANIXITY";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.innerHTML = `
    <div class="typing-indicator">
      <span></span><span></span><span></span>
    </div>`;

  body.appendChild(label);
  body.appendChild(bubble);
  wrapper.appendChild(avatar);
  wrapper.appendChild(body);
  chatWindow.appendChild(wrapper);
  scrollToBottom();

  return wrapper;
}

/** Removes the typing indicator from the DOM. */
function removeTypingIndicator() {
  const el = document.getElementById("typing-msg");
  if (el) el.remove();
}

/** Scrolls the chat window to the bottom. */
function scrollToBottom() {
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/**
 * Animates text into a bubble one character at a time (typewriter effect).
 * A blinking cursor is shown while typing and removed when done.
 * @param {HTMLElement} bubble - The bubble element to write into
 * @param {string}      text   - Full text to animate
 */
async function animateText(bubble, text) {
  bubble.textContent = "";

  // Insert blinking cursor at the end
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  bubble.appendChild(cursor);

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const chars = [...text]; // Spread handles multi-byte Unicode / emoji

  for (let i = 0; i < chars.length; i++) {
    // Insert each character just before the cursor span
    bubble.insertBefore(document.createTextNode(chars[i]), cursor);
    scrollToBottom();
    // Adaptive speed: slower for short replies, faster for long ones
    await delay(chars.length > 400 ? 8 : 18);
  }

  cursor.remove(); // Animation complete — hide cursor
}

/* ──────────────────────────────────────────────────────────
   SEND MESSAGE — Main flow controller
────────────────────────────────────────────────────────── */
async function handleSend() {
  const text = userInput.value.trim();
  if (!text || isProcessing) return;

  // 1. Render user message
  appendMessage("user", text);

  // 2. Clear and reset input box
  userInput.value = "";
  userInput.style.height = "auto";

  // 3. Lock UI while waiting
  isProcessing       = true;
  sendBtn.disabled   = true;
  userInput.disabled = true;

  // 4. Push to conversation history for context
  conversationHistory.push({ role: "user", content: text });

  // 5. Show "thinking" dots
  showTypingIndicator();

  try {
    // 6. Call Groq API
    const reply = await callGroqAPI(conversationHistory);

    // 7. Swap typing indicator for animated reply
    removeTypingIndicator();
    const bubble = appendMessage("bot", "");
    await animateText(bubble, reply);

    // 8. Save bot reply to history
    conversationHistory.push({ role: "assistant", content: reply });

  } catch (err) {
    removeTypingIndicator();
    const errMsg = `[ERROR] ${err.message || "Failed to reach Groq API. Check your API key and network connection."}`;
    appendMessage("bot", errMsg);

  } finally {
    // 9. Always unlock UI
    isProcessing       = false;
    sendBtn.disabled   = false;
    userInput.disabled = false;
    userInput.focus();
  }
}

/* ──────────────────────────────────────────────────────────
   GROQ API CALL
   Uses the OpenAI-compatible /v1/chat/completions endpoint.
   Full conversation history is sent each turn so the model
   remembers previous messages.
────────────────────────────────────────────────────────── */
async function callGroqAPI(messages) {
  const payload = {
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT }, // Personality + rules
      ...messages                                  // Full conversation history
    ],
    max_tokens:  1024, // Maximum length of each reply
    temperature: 0.7,  // 0 = deterministic, 1 = creative
    stream:      false // Change to true + handle SSE for real-time streaming
  };

  const response = await fetch(GROQ_ENDPOINT, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}` // API key sent in Authorization header
    },
    body: JSON.stringify(payload)
  });

  // Handle HTTP-level errors (401 bad key, 429 rate limit, etc.)
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const detail  = errBody?.error?.message || response.statusText;
    throw new Error(`Groq API ${response.status}: ${detail}`);
  }

  // Parse and return the assistant's message text
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "[No response received]";
}

/* ──────────────────────────────────────────────────────────
   AUTO-FOCUS — Place cursor in input on page load
────────────────────────────────────────────────────────── */
userInput.focus();
