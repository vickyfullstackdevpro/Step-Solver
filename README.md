# ⚡ Gemini Live Exam & Question Solver

A high-performance Manifest V3 Chrome Extension powered by Google Gemini AI designed to automatically analyze, solve, and interact with on-screen online assessments, exams, and quizzes in real time.

---

## ✨ Key Features

- 🎯 **Multi-Format Question Solver**:
  - **Multiple Choice (MCQ)**: Detects single/multi-choice radio & checkbox options and automatically selects the highest-scoring answer.
  - **Sentence & Phrase Rearrangement**: Automatically detects scrambled sentence tokens/chips and sequences them into coherent, grammatical sentences.
  - **Vocabulary & Dropdowns**: Automatically matches and selects correct dropdown options (`<select>`) and fill-in-the-blank text inputs.
  - **Long-Form Writing**: Crafts context-aware, articulate essay and paragraph answers directly into text areas.
  - **Speaking Teleprompter**: Provides an on-screen reading overlay with natural speech scripts and pacing guidelines for oral questions.

- 🔑 **Multi-API Key Pool & Auto-Failover**:
  - Store up to **10 Gemini API keys** in your secure local pool.
  - **Zero-Downtime Failover**: If an active key encounters an HTTP 429 rate limit or quota exhaustion, the extension automatically rotates to the next standby key in your pool and retries seamlessly.

- 🤖 **100% Automatic AI Model Selection**:
  - Automatically identifies and uses the best available Flash model (`gemini-3.6-flash`, `gemini-2.0-flash`, `gemini-1.5-flash`) for each key with zero manual model configuration needed.

- ⚡ **Controlled Auto-Solve Loop**:
  - **Strict "Solve Once Per Question" Engine**: Uses global question fingerprinting to guarantee a question is only answered once, avoiding duplicate API calls and conserving token quota.
  - Automatically activates when navigating to the next question.

- 🎨 **Floating Glassmorphism HUD**:
  - Smooth, draggable controller with live status badges.
  - One-click power toggle to instantly hide and disable all extension elements.
  - Persistent answer banner that stays on-screen until you advance to the next question.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt + S` | **Solve Current Question** on screen |
| `Alt + H` | **Minimize / Expand** floating HUD |

---

## 🚀 Installation & Setup

1. Clone or download this repository.
2. Open Google Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the `Extension` directory.
5. Click the extension icon in the toolbar, enter your **Google AI Studio API Key**, and click **Add Key**.
