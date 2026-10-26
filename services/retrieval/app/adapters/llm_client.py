import asyncio
import logging
from typing import Protocol, runtime_checkable
import httpx

logger = logging.getLogger(__name__)


@runtime_checkable
class LLMClient(Protocol):
    """Protocol for vendor-neutral LLM completions."""

    async def complete(self, prompt: str, system_prompt: str | None = None) -> str:
        ...


class HttpLLMClient:
    """
    Vendor-neutral HTTP adapter for LLM inference (compatible with OpenAI, Ollama, vLLM, etc.).
    Includes hard timeouts, max tokens, and a single bounded retry.
    """

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str = "",
        timeout_seconds: float = 15.0,
        max_tokens: int = 512,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.max_tokens = max_tokens

    async def complete(self, prompt: str, system_prompt: str | None = None) -> str:
        headers = {
            "Content-Type": "application/json",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": self.max_tokens,
            "temperature": 0.0,
        }

        url = f"{self.base_url}/chat/completions"

        # Bounded retry: up to 1 retry on connection/timeout error
        attempts = 0
        max_attempts = 2
        last_error = None

        while attempts < max_attempts:
            attempts += 1
            try:
                async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                    response = await client.post(url, json=payload, headers=headers)
                    response.raise_for_status()
                    data = response.json()
                    return data["choices"][0]["message"]["content"].strip()
            except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as e:
                last_error = e
                logger.warning(f"LLM request attempt {attempts} failed: {e}")
                if attempts < max_attempts:
                    await asyncio.sleep(0.5)

        raise RuntimeError(f"LLMClient failed after {max_attempts} attempts: {last_error}")


class MockLLMClient:
    """Mock LLM client for tests and offline development."""

    def __init__(self, fixed_response: str | None = None) -> None:
        self.fixed_response = fixed_response

    async def complete(self, prompt: str, system_prompt: str | None = None) -> str:
        if self.fixed_response is not None:
            return self.fixed_response
        return (
            "Based on the verified facts, Neon is a serverless, cloud-hosted PostgreSQL database service. "
            "[Fact 1]"
        )
