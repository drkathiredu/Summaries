FROM node:20-alpine AS builder

WORKDIR /app

# Copy package configuration
COPY package*.json ./
RUN npm install

# Copy application source
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

# Copy package configuration and built assets
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist

# Install only production dependencies
RUN npm install --omit=dev

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Create data directory for templates
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "start"]
