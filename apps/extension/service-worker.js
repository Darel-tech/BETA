
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "BETA_CHECK_ANSWER") {
    return;
  }

  fetch("http://localhost:3000/api/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: message.text,
      source: message.source
    })
  })
    .then(async (response) => {
      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || "BETA API request failed"
        );
      }

      sendResponse({
        success: true,
        result
      });
    })
    .catch((error) => {
      sendResponse({
        success: false,
        error: error.message
      });
    });

  return true;
});
