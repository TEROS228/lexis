#!/bin/bash

# VPS Deployment Script for Lexis API
# Usage: chmod +x deploy-vps.sh && ./deploy-vps.sh

set -e

echo "🚀 Starting VPS deployment..."

VPS_IP="109.123.238.213"
VPS_USER="root"
APP_DIR="/var/www/lexis-api"

echo "📦 Creating deployment package..."
tar -czf lexis-api.tar.gz \
  server.js \
  ecosystem.config.cjs \
  package.json \
  package-lock.json \
  .env.vps \
  --exclude node_modules

echo "📤 Uploading to VPS..."
scp lexis-api.tar.gz ${VPS_USER}@${VPS_IP}:/tmp/

echo "🔧 Setting up on VPS..."
ssh ${VPS_USER}@${VPS_IP} << 'ENDSSH'
  set -e

  # Create app directory
  mkdir -p /var/www/lexis-api
  cd /var/www/lexis-api

  # Extract files
  tar -xzf /tmp/lexis-api.tar.gz
  rm /tmp/lexis-api.tar.gz

  # Rename env file
  mv .env.vps .env

  # Install dependencies
  npm ci --production

  # Create logs directory
  mkdir -p logs

  # Restart with PM2
  pm2 delete lexis-api || true
  pm2 start ecosystem.config.cjs
  pm2 save

  echo "✅ Deployment complete!"
ENDSSH

echo "🎉 Deployment finished! API running at http://${VPS_IP}:4000"
echo "🔍 Check health: curl http://${VPS_IP}:4000/health"

# Cleanup
rm lexis-api.tar.gz
