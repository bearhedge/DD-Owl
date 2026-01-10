# Use Node with Puppeteer support
FROM ghcr.io/puppeteer/puppeteer:23.0.0

# Set working directory
WORKDIR /app

# Switch to root to install dependencies
USER root

# Copy package files
COPY package*.json ./

# Install npm dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Fix permissions for pptruser
RUN chown -R pptruser:pptruser /app

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Cloud Run port
ENV PORT=8080
EXPOSE 8080

# Switch back to non-root user for security
USER pptruser

# Start the server
CMD ["npm", "start"]
