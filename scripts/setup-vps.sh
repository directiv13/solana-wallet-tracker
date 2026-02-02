#!/bin/bash

# VPS Setup Script for Solana Wallet Tracker
# Run this script on your VPS to prepare it for deployment

set -e

echo "==================================="
echo "Solana Wallet Tracker - VPS Setup"
echo "==================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root or with sudo"
  exit 1
fi

# Update system
echo "Updating system packages..."
apt-get update
apt-get upgrade -y

# Install Docker
echo "Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
else
    echo "Docker already installed"
fi

# Install Docker Compose
echo "Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_VERSION="v2.24.0"
    curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
else
    echo "Docker Compose already installed"
fi

# Create deployment user if it doesn't exist
DEPLOY_USER="deployer"
if ! id "$DEPLOY_USER" &>/dev/null; then
    echo "Creating deployment user: $DEPLOY_USER"
    useradd -m -s /bin/bash $DEPLOY_USER
    usermod -aG docker $DEPLOY_USER
else
    echo "User $DEPLOY_USER already exists"
fi

# Setup deployment directory
echo "Setting up deployment directory..."
DEPLOY_DIR="/home/$DEPLOY_USER/solana-tracker"
mkdir -p $DEPLOY_DIR
chown -R $DEPLOY_USER:$DEPLOY_USER $DEPLOY_DIR

# Setup SSH for GitHub Actions
echo "Setting up SSH..."
DEPLOY_USER_HOME="/home/$DEPLOY_USER"
mkdir -p $DEPLOY_USER_HOME/.ssh
chmod 700 $DEPLOY_USER_HOME/.ssh
touch $DEPLOY_USER_HOME/.ssh/authorized_keys
chmod 600 $DEPLOY_USER_HOME/.ssh/authorized_keys
chown -R $DEPLOY_USER:$DEPLOY_USER $DEPLOY_USER_HOME/.ssh

echo ""
echo "==================================="
echo "Setup complete!"
echo "==================================="
echo ""
echo "Next steps:"
echo "1. Add your GitHub Actions SSH public key to: $DEPLOY_USER_HOME/.ssh/authorized_keys"
echo "2. Copy your .env file to: $DEPLOY_DIR/.env"
echo "3. Set the following GitHub Secrets:"
echo "   - VPS_HOST: Your VPS IP or domain"
echo "   - VPS_USER: $DEPLOY_USER"
echo "   - VPS_SSH_KEY: Your private SSH key"
echo ""
echo "To generate SSH key pair for GitHub Actions:"
echo "  ssh-keygen -t ed25519 -C 'github-actions' -f ~/.ssh/github_actions"
echo "  # Add public key (.pub) to $DEPLOY_USER_HOME/.ssh/authorized_keys"
echo "  # Add private key to GitHub Secrets as VPS_SSH_KEY"
echo ""
echo "To test SSH connection:"
echo "  ssh $DEPLOY_USER@YOUR_VPS_IP"
echo ""
