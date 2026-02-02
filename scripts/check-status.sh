#!/bin/bash

# Check deployment status script
# Usage: ./scripts/check-status.sh [VPS_HOST] [VPS_USER]

set -e

VPS_HOST=${1:-$VPS_HOST}
VPS_USER=${2:-deployer}

if [ -z "$VPS_HOST" ]; then
  echo "Error: VPS_HOST not provided"
  echo "Usage: ./scripts/check-status.sh <VPS_HOST> [VPS_USER]"
  echo "Or set VPS_HOST environment variable"
  exit 1
fi

echo "=================================="
echo "Solana Wallet Tracker - Status Check"
echo "=================================="
echo "VPS: $VPS_USER@$VPS_HOST"
echo ""

# Check if VPS is reachable
echo "🔍 Checking VPS connectivity..."
if ssh -o ConnectTimeout=5 $VPS_USER@$VPS_HOST "echo 'Connected'" > /dev/null 2>&1; then
  echo "✅ VPS is reachable"
else
  echo "❌ Cannot connect to VPS"
  exit 1
fi

# Check Docker
echo ""
echo "🐳 Checking Docker..."
if ssh $VPS_USER@$VPS_HOST "docker --version" > /dev/null 2>&1; then
  echo "✅ Docker is installed"
else
  echo "❌ Docker is not installed"
fi

# Check Docker Compose
echo ""
echo "📦 Checking Docker Compose..."
if ssh $VPS_USER@$VPS_HOST "docker-compose --version" > /dev/null 2>&1; then
  echo "✅ Docker Compose is installed"
else
  echo "❌ Docker Compose is not installed"
fi

# Check deployment directory
echo ""
echo "📁 Checking deployment directory..."
if ssh $VPS_USER@$VPS_HOST "test -d ~/solana-tracker && echo 'exists'" | grep -q "exists"; then
  echo "✅ Deployment directory exists"
else
  echo "❌ Deployment directory not found"
  exit 1
fi

# Check .env file
echo ""
echo "⚙️  Checking configuration..."
if ssh $VPS_USER@$VPS_HOST "test -f ~/solana-tracker/.env && echo 'exists'" | grep -q "exists"; then
  echo "✅ Environment file exists"
else
  echo "⚠️  Environment file not found"
fi

# Check containers
echo ""
echo "🚢 Checking containers..."
CONTAINERS=$(ssh $VPS_USER@$VPS_HOST 'cd ~/solana-tracker && docker-compose ps 2>/dev/null')

if echo "$CONTAINERS" | grep -q "solana-tracker-app"; then
  if echo "$CONTAINERS" | grep "solana-tracker-app" | grep -q "Up"; then
    echo "✅ Application container is running"
  else
    echo "❌ Application container is not running"
  fi
else
  echo "❌ Application container not found"
fi

if echo "$CONTAINERS" | grep -q "solana-tracker-redis"; then
  if echo "$CONTAINERS" | grep "solana-tracker-redis" | grep -q "Up"; then
    echo "✅ Redis container is running"
  else
    echo "❌ Redis container is not running"
  fi
else
  echo "❌ Redis container not found"
fi

if echo "$CONTAINERS" | grep -q "solana-tracker-nginx"; then
  if echo "$CONTAINERS" | grep "solana-tracker-nginx" | grep -q "Up"; then
    echo "✅ Nginx container is running"
  else
    echo "❌ Nginx container is not running"
  fi
else
  echo "❌ Nginx container not found"
fi

# Health check
echo ""
echo "🏥 Checking health endpoint..."
HEALTH_CHECK=$(ssh $VPS_USER@$VPS_HOST 'curl -s -o /dev/null -w "%{http_code}" http://localhost/health 2>/dev/null' || echo "000")

if [ "$HEALTH_CHECK" == "200" ]; then
  echo "✅ Health check passed (HTTP 200)"
else
  echo "❌ Health check failed (HTTP $HEALTH_CHECK)"
fi

# Check recent logs for errors
echo ""
echo "📋 Checking recent logs..."
ERROR_COUNT=$(ssh $VPS_USER@$VPS_HOST 'cd ~/solana-tracker && docker-compose logs --tail=100 2>/dev/null | grep -i "error" | wc -l' || echo "0")

if [ "$ERROR_COUNT" -eq "0" ]; then
  echo "✅ No errors in recent logs"
else
  echo "⚠️  Found $ERROR_COUNT errors in recent logs"
  echo "   Run: ssh $VPS_USER@$VPS_HOST 'cd ~/solana-tracker && docker-compose logs --tail=50'"
fi

# Summary
echo ""
echo "=================================="
echo "Summary"
echo "=================================="
ssh $VPS_USER@$VPS_HOST 'cd ~/solana-tracker && docker-compose ps 2>/dev/null'

echo ""
echo "📊 Resource Usage:"
ssh $VPS_USER@$VPS_HOST 'docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null | head -4'

echo ""
echo "🔗 Useful commands:"
echo "  View logs:    ssh $VPS_USER@$VPS_HOST 'cd ~/solana-tracker && docker-compose logs -f'"
echo "  Restart:      ssh $VPS_USER@$VPS_HOST 'cd ~/solana-tracker && docker-compose restart'"
echo "  Stop:         ssh $VPS_USER@$VPS_HOST 'cd ~/solana-tracker && docker-compose down'"
echo "  Start:        ssh $VPS_USER@$VPS_HOST 'cd ~/solana-tracker && docker-compose up -d'"
echo ""
