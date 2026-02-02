#!/bin/bash

# Manual deployment script for VPS
# Use this to deploy without GitHub Actions

set -e

# Configuration
VPS_USER="${VPS_USER:-deployer}"
VPS_HOST="${VPS_HOST:-your-vps-ip}"
DEPLOY_DIR="solana-tracker"

echo "==================================="
echo "Deploying to VPS"
echo "==================================="
echo "VPS: $VPS_USER@$VPS_HOST"
echo "Directory: ~/$DEPLOY_DIR"
echo ""

# Build Docker image locally
echo "Building Docker image..."
docker build -t solana-tracker:latest .

# Save image to file
echo "Saving Docker image..."
docker save solana-tracker:latest | gzip > solana-tracker.tar.gz

# Copy files to VPS
echo "Copying files to VPS..."
ssh $VPS_USER@$VPS_HOST "mkdir -p ~/$DEPLOY_DIR"
scp solana-tracker.tar.gz $VPS_USER@$VPS_HOST:~/$DEPLOY_DIR/
scp docker-compose.prod.yml $VPS_USER@$VPS_HOST:~/$DEPLOY_DIR/docker-compose.yml
scp -r nginx $VPS_USER@$VPS_HOST:~/$DEPLOY_DIR/

# Deploy on VPS
echo "Deploying on VPS..."
ssh $VPS_USER@$VPS_HOST << 'EOF'
  cd ~/solana-tracker
  
  # Load new image
  docker load < solana-tracker.tar.gz
  
  # Pull latest base images
  docker-compose pull redis nginx
  
  # Stop old containers
  docker-compose down
  
  # Start new containers
  docker-compose up -d
  
  # Clean up
  docker image prune -f
  rm solana-tracker.tar.gz
  
  # Show status
  echo ""
  echo "Deployment complete!"
  docker-compose ps
EOF

# Cleanup local artifact
rm solana-tracker.tar.gz

echo ""
echo "==================================="
echo "Deployment successful! 🚀"
echo "==================================="
echo ""
echo "Check status: ssh $VPS_USER@$VPS_HOST 'cd ~/$DEPLOY_DIR && docker-compose ps'"
echo "View logs: ssh $VPS_USER@$VPS_HOST 'cd ~/$DEPLOY_DIR && docker-compose logs -f'"
echo ""
