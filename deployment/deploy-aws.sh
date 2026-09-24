#!/usr/bin/env bash
# ==============================================================================
# CCMRS Automated AWS Deployment Script
# Supports: AWS ECS Fargate & AWS Elastic Beanstalk
# ==============================================================================

set -e

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-123456789012}"
ECR_REPO_NAME="ccmrs-app"
IMAGE_TAG="latest"
ECS_CLUSTER_NAME="ccmrs-cluster"
ECS_SERVICE_NAME="ccmrs-service"

echo "======================================================"
echo "🚀 Starting CCMRS Automated AWS Deployment Pipeline"
echo "Region: $AWS_REGION | Repository: $ECR_REPO_NAME"
echo "======================================================"

# Step 1: Validate Prerequisites
command -v aws >/dev/null 2>&1 || { echo "❌ AWS CLI is required but not installed. Aborting."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required but not installed. Aborting."; exit 1; }

# Step 2: Build Docker Image
echo "📦 Building Production Docker Image..."
docker build -t "$ECR_REPO_NAME:$IMAGE_TAG" .

# Step 3: Login to Amazon ECR
echo "🔐 Logging into Amazon ECR..."
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# Step 4: Tag & Push Image
ECR_URI="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:$IMAGE_TAG"
echo "🏷️ Tagging image as $ECR_URI..."
docker tag "$ECR_REPO_NAME:$IMAGE_TAG" "$ECR_URI"

echo "⬆️ Pushing image to Amazon ECR..."
docker push "$ECR_URI"

# Step 5: Update AWS ECS Service
echo "🔄 Updating AWS ECS Fargate Service ($ECS_SERVICE_NAME)..."
aws ecs update-service \
    --cluster "$ECS_CLUSTER_NAME" \
    --service "$ECS_SERVICE_NAME" \
    --force-new-deployment \
    --region "$AWS_REGION"

echo "======================================================"
echo "✅ CCMRS Deployment to AWS ECS Completed Successfully!"
echo "======================================================"
