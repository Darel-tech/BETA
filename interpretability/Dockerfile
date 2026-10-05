# Use a standard, slim Python image.
# For GPU tiers on Hugging Face Spaces, the standard Python image works perfectly
# as pip will automatically install the CUDA-compatible version of PyTorch.
FROM python:3.10-slim

# Set environment variables for Python and Hugging Face
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Hugging Face Spaces run on port 7860 by default
    PORT=7860 \
    # Add pip user install directory to PATH
    PATH="/home/user/.local/bin:$PATH"

# Install git and other system dependencies if needed by PyTorch/TransformerLens
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Hugging Face strongly recommends running as a non-root user (UID 1000)
RUN useradd -m -u 1000 user

# Set the working directory
WORKDIR /app

# Switch to the non-root user
USER user

# Copy the requirements file first to leverage Docker layer caching
COPY --chown=user:user requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir --user -r requirements.txt

# Copy the rest of the application code
COPY --chown=user:user . .

# Expose the port
EXPOSE $PORT

# Run the FastAPI application using uvicorn
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port $PORT"]
