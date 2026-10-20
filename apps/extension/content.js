
(() => {
  const host = window.location.hostname;

  // Send an extracted answer to the BETA API through the
  // extension's background service worker.
  function sendAnswerToBeta(answer, source) {
    chrome.runtime.sendMessage(
      {
        type: "BETA_CHECK_ANSWER",
        text: answer,
        source: source
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "BETA extension error:",
            chrome.runtime.lastError.message
          );
          return;
        }

        if (!response || !response.success) {
          console.error(
            "BETA API error:",
            response?.error || "No response from service worker"
          );
          return;
        }

        console.log("BETA: Evaluation result:");
        console.log(response.result);

        showBetaResult(response.result, answer);
      }
    );
  }

  // Display the API result on the current page.
  function showBetaResult(result, checkedAnswer) {
    let panel = document.getElementById("beta-result-panel");

    if (!panel) {
      panel = document.createElement("div");
      panel.id = "beta-result-panel";

      Object.assign(panel.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: "999999",
        background: "#ffffff",
        color: "#222222",
        padding: "16px",
        borderRadius: "12px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
        fontFamily: "Arial, sans-serif",
        fontSize: "14px",
        width: "280px",
        maxHeight: "60vh",
        overflowY: "auto",
        border: "1px solid #dddddd"
      });

      document.body.appendChild(panel);
    }

    panel.replaceChildren();

    const heading = document.createElement("div");
    heading.textContent = "BETA Answer Evaluation";
    heading.style.fontWeight = "bold";
    heading.style.marginBottom = "10px";

    const verdictText = document.createElement("div");
    verdictText.textContent =
      "Verdict: " + (result?.verdict ?? "Unknown");

    const confidenceText = document.createElement("div");
    const confidence = result?.confidence;

    confidenceText.textContent =
      "Confidence: " +
      (typeof confidence === "number"
        ? Math.round(confidence * 100) + "%"
        : "N/A");

    const evidenceHeading = document.createElement("div");
    evidenceHeading.textContent = "Evidence:";
    evidenceHeading.style.fontWeight = "bold";
    evidenceHeading.style.marginTop = "12px";

    const evidenceList = document.createElement("ul");
    evidenceList.style.paddingLeft = "20px";
    evidenceList.style.marginBottom = "0";

    const evidence = Array.isArray(result?.evidence)
      ? result.evidence
      : [];

    if (evidence.length > 0) {
      evidence.forEach((item) => {
        const listItem = document.createElement("li");
        listItem.textContent = String(item);
        listItem.style.marginTop = "6px";
        evidenceList.appendChild(listItem);
      });
    } else {
      const listItem = document.createElement("li");
      listItem.textContent = "No evidence available.";
      evidenceList.appendChild(listItem);
    }

    const closeButton = document.createElement("button");
    closeButton.textContent = "Close";
    closeButton.style.marginTop = "12px";
    closeButton.style.padding = "6px 12px";
    closeButton.style.cursor = "pointer";
    closeButton.addEventListener("click", () => panel.remove());

    const answerHeading = document.createElement("div");
answerHeading.textContent = "Answer checked:";
answerHeading.style.fontWeight = "bold";
answerHeading.style.marginTop = "12px";

const answerText = document.createElement("div");
answerText.textContent = checkedAnswer || "Answer unavailable";
answerText.style.marginTop = "6px";
answerText.style.whiteSpace = "pre-wrap";
answerText.style.overflowWrap = "anywhere";
    panel.append(
      heading,
      answerHeading,
      answerText,
      verdictText,
      confidenceText,
      evidenceHeading,
      evidenceList,
      closeButton
    );
  }

  // Extract the latest assistant answer from ChatGPT.
  function getLatestChatGPTAnswer() {
    const containers = [
      ...document.querySelectorAll(
        "[data-content-search-unit-key]"
      )
    ].filter((element) =>
      element
        .getAttribute("data-content-search-unit-key")
        ?.includes(":assistant")
    );

    if (containers.length === 0) {
      return null;
    }

    const latest = containers[containers.length - 1];

    const answer = latest.innerText
      .split("\n")
      .filter(
        (line) =>
          line.trim() &&
          line.trim() !== "ChatGPT said:"
      )
      .join("\n")
      .trim();

    return answer || null;
  }

  // Try common Claude answer selectors.
  // These selectors must be verified against the live page.
  
  // Extract the latest assistant answer from Claude.
  function getLatestClaudeAnswer() {
    const messages = document.querySelectorAll(
      '[data-testid="assistant-message"]'
    );

    if (messages.length === 0) {
      return null;
    }

    const latestMessage = messages[messages.length - 1];

    // Prefer the element that contains the actual response text.
    const replyText = latestMessage.querySelector(
      "[data-perf-reply-text]"
    );

    const answer = (
      replyText || latestMessage
    ).innerText?.trim();

    return answer || null;
  }


  // Retry extraction because answers may take time to appear.
  function startAnswerDetection(source, getAnswer) {
  let lastSentAnswer = "";
  let checkInProgress = false;

  async function checkForNewAnswer() {
    if (checkInProgress) return;

    const answer = getAnswer();

    if (!answer || answer === lastSentAnswer) return;

    checkInProgress = true;
    lastSentAnswer = answer;

    console.log(
      "BETA: New " +
        (source === "chatgpt" ? "ChatGPT" : "Claude") +
        " answer detected:"
    );
    console.log(answer);

    sendAnswerToBeta(answer, source);

    checkInProgress = false;
  }

  // Check the current answer and keep watching for new replies.
  checkForNewAnswer();
  setInterval(checkForNewAnswer, 1500);
}

  // Run only on supported websites.
  if (host === "chatgpt.com") {
    console.log("BETA extension detected: ChatGPT");

    startAnswerDetection(
      "chatgpt",
      getLatestChatGPTAnswer
    );
  } else if (host === "claude.ai") {
    console.log("BETA extension detected: Claude");

    startAnswerDetection(
      "claude",
      getLatestClaudeAnswer
    );
  }
})();
