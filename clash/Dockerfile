# Use the official Rust image as the base
FROM rust:latest

# Install Node.js (required for Junie CLI) and other system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    build-essential \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_current.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
RUN useradd --uid 1000 --create-home --home-dir /junie junie
WORKDIR /junie
USER junie

# Install Junie CLI in the user environment
ENV PATH="/junie/.local/bin:${PATH}"

CMD ["/bin/bash"]
