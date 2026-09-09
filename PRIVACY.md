# Privacy Policy for Step Solver

**Last Updated:** September 2026  
**Publisher:** ExamPilot Labs  
**Repository:** [https://github.com/vickyfullstackdevpro/ExamPilot-AI](https://github.com/vickyfullstackdevpro/ExamPilot-AI)

---

## 1. Overview
Step Solver ("we", "our", or "the Extension") is dedicated to protecting user privacy. This Privacy Policy outlines how the Extension handles information when you use it within the browser.

## 2. Information We Collect and Process
- **API Keys**: When you provide Google Gemini API keys in the extension popup, they are stored **strictly on your local device** using the browser's encrypted `chrome.storage.local` API. We do not have access to your API keys, nor are they ever transmitted to any developer-owned servers.
- **Assessment Content**: When you trigger a scan or solve action (`Alt+S`), on-screen question text, options, and contextual elements are captured from the active browser tab solely to construct an AI prompt.
- **Data Transmission**: Prompts containing question text are transmitted directly and securely over encrypted HTTPS connections exclusively to Google's official Gemini API endpoint (`generativelanguage.googleapis.com`) to generate answers.

## 3. What We Do NOT Collect
- We **do not** collect personal identification information (names, emails, physical addresses, or payment details).
- We **do not** track your browsing history or monitor activity outside the active tab when you explicitly trigger the extension.
- We **do not** sell, lease, monetize, or share your data or query content with any advertisers, data brokers, or third parties.
- We **do not** employ third-party tracking pixels, telemetry SDKs, or analytics trackers.

## 4. Browser Permissions Justification
- **`storage`**: Used solely to persist your local user preferences, selected models, and Gemini API keys directly in your browser.
- **`activeTab` & `scripting`**: Required to inspect question text and render the non-intrusive HUD banner on the webpage when you explicitly request a solution.
- **`<all_urls>`**: Necessary because educational assessments, quizzes, and learning portals are hosted across varied educational and institutional domains worldwide.

## 5. Security
All communications with the Google Gemini API occur over Transport Layer Security (TLS/HTTPS). Because all data remains local to your browser session, no user accounts or passwords are stored on external servers.

## 6. Updates to This Policy
We may update this Privacy Policy to reflect changes in our practices or browser platform policies. The revised policy will always be published on our official repository.

## 7. Contact
If you have questions, feedback, or concerns regarding this Privacy Policy, please open an issue on our GitHub repository:  
[https://github.com/vickyfullstackdevpro/ExamPilot-AI/issues](https://github.com/vickyfullstackdevpro/ExamPilot-AI/issues)
