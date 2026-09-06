# 🚀 ExamPilot AI: Live Gemini Exam & Question Solver

A high-performance Manifest V3 Chrome Extension powered by Google Gemini AI designed to automatically analyze, solve, and interact with on-screen online assessments, exams, and quizzes in real time.

---

## ✨ Features & Capabilities

- 🎯 **Multi-Format Assessment Solver**:
  - **Multiple Choice (MCQ)**: Detects single/multi-choice radio & checkbox options and custom option cards. Automatically selects the highest-scoring answer with realistic synthetic pointer events.
  - **Sentence & Phrase Rearrangement**: Automatically detects scrambled sentence tokens/chips and sequences them into coherent, grammatical sentences.
  - **Choose the Correct Word / Vocabulary**: Identifies dropdowns (`<select>`) and fill-in text blanks, dispatching native reactive change events.
  - **Long-Form Writing**: Formulates articulate, high-scoring essay responses directly populated into `<textarea>` or `contenteditable` containers.
  - **Speaking Teleprompter**: Provides an on-screen reading overlay with natural speech scripts and pacing guidelines for oral voice assessments.

- 🔑 **Multi-API Key Pool (Up to 10 Keys)**:
  - Add and manage up to 10 Gemini API keys in your local secure pool.
  - **Zero-Downtime Failover**: If an active key hits an HTTP 429 rate limit or daily quota drain, ExamPilot AI automatically rotates to the next standby key in your pool and retries immediately.

- 🤖 **Automatic AI Model Selection**:
  - Automatically identifies and utilizes the optimal supported Flash model (`gemini-3.6-flash`, `gemini-2.0-flash`, `gemini-1.5-flash`) for each key without any manual model selection needed.

- ⚡ **Strict "Solve Once Per Question" Engine**:
  - Employs global question fingerprinting to guarantee a question is only solved once, eliminating duplicate API calls and saving token quota.
  - Auto-solve automatically wakes when you advance to the next question.

- 🎨 **Floating Glassmorphism Controller**:
  - Smooth 1:1 draggable HUD widget with live status badges.
  - One-click master power toggle to instantly hide/disable all extension components.
  - Persistent answer banner that stays on-screen until you advance to the next question.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| <kbd>Alt</kbd> + <kbd>S</kbd> | **Solve Current Question** | Scans the visible question, queries Gemini, and applies the solution. |
| <kbd>Alt</kbd> + <kbd>H</kbd> | **Toggle Floating HUD** | Minimizes or expands the on-screen assistant widget. |

---

## 🚀 Installation & Setup

1. Clone or download this repository:
   ```bash
   git clone https://github.com/vickyfullstackdevpro/ExamPilot-AI.git
   ```
2. Open Google Chrome and navigate to: `chrome://extensions/`
3. Enable **"Developer mode"** in the top-right corner.
4. Click **"Load unpacked"** in the top-left corner.
5. Select the `Extension` repository directory.
6. Click the extension icon in Chrome's toolbar, enter your **Google AI Studio API Key**, and click **Add Key**.

---

## 🧪 Interactive Testing Playground

Open `playground.html` in Chrome to test the extension across all 5 supported question types in a sandboxed assessment environment with live answer grading.

---

## 📜 License

MIT License. Designed for study assistance, educational research, and assessment automation.
