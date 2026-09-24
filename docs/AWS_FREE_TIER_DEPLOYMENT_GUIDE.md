# 🚀 100% AWS Free Tier Deployment Guide: CCMRS

This guide walks you through deploying **CCMRS (Omnichannel Customer Complaint Management & Resolution System)** to **Amazon Web Services (AWS)** using **100% Free Tier Services** with zero cloud bill.

---

## 📋 AWS Free Tier Specifications Used

| Component | AWS Free Tier Service | Allowance | Cost |
| :--- | :--- | :--- | :--- |
| **Compute Server** | **Amazon EC2** (`t2.micro` or `t3.micro`) | 750 hours/month (12 Months Free) | **$0.00** |
| **Storage** | **Amazon EBS** (General Purpose SSD - gp3) | 30 GB Free Storage | **$0.00** |
| **Process Manager** | **PM2 / Docker** | Self-hosted on EC2 instance | **$0.00** |
| **AI Fallback** | **CCMRS Contextual AI Engine** | Self-hosted NLP engine (0 API costs) | **$0.00** |

---

## 🛠️ Step-by-Step Deployment Walkthrough

---

### Step 1: Launch an AWS EC2 Free Tier Instance

1. Log into your [AWS Management Console](https://console.aws.amazon.com/).
2. In the top search bar, type **EC2** and click **EC2 Dashboard**.
3. Click the orange **Launch Instance** button.
4. Fill in the instance configuration:
   * **Name:** `CCMRS-Production-Server`
   * **Application and OS Images (AMI):** Select **Ubuntu** $\to$ choose **Ubuntu Server 24.04 LTS (HVM)** *(Make sure it says "Free tier eligible")*.
   * **Instance Type:** Select **`t2.micro`** (or `t3.micro` if in `ap-south-1` Mumbai / regions where t3 is default Free Tier).
   * **Key pair (login):**
     * Click **Create new key pair**.
     * Name it `ccmrs-key`.
     * Key pair type: **RSA**, Private key format: **`.pem`** (for Mac/Linux) or **`.ppk`** (for PuTTY).
     * Click **Create key pair** and download the file to your computer.

---

### Step 2: Configure Network & Security Group (Firewall)

Under **Network settings**:
1. Select **Create security group**.
2. Check the following checkboxes:
   * ✅ **Allow SSH traffic from** $\to$ `Anywhere (0.0.0.0/0)` *(or My IP)*
   * ✅ **Allow HTTP traffic from the internet** (Port 80)
   * ✅ **Allow HTTPS traffic from the internet** (Port 443)
3. Click **Edit** on Network settings and click **Add security group rule**:
   * **Type:** `Custom TCP`
   * **Port Range:** `5001`
   * **Source:** `0.0.0.0/0` (Anywhere)
   * **Description:** `CCMRS Web Portal & API`
4. Under **Configure storage**: Leave as default **8 GiB gp3** (Free tier allows up to 30 GiB).
5. Click **Launch Instance** in the bottom right!

---

### Step 3: Connect to Your AWS EC2 Server

1. Once the instance state is **Running**, click on your instance to view details.
2. Note your **Public IPv4 Address** (e.g. `13.233.45.120`).
3. Open your Mac Terminal and navigate to where you downloaded `ccmrs-key.pem`:
   ```bash
   cd ~/Downloads
   chmod 400 ccmrs-key.pem
   ```
4. Connect via SSH:
   ```bash
   ssh -i "ccmrs-key.pem" ubuntu@<YOUR_EC2_PUBLIC_IP>
   ```
   *(Replace `<YOUR_EC2_PUBLIC_IP>` with your instance's actual IP address)*.
   Type `yes` when prompted.

---

### Step 4: Install Node.js 20, Git & PM2 on the Server

Run these commands in your SSH terminal:

```bash
# 1. Update package lists
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 20 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git build-essential

# 3. Verify versions
node -v
npm -v

# 4. Install PM2 process manager globally (keeps server running 24/7)
sudo npm install -g pm2
```

---

### Step 5: Transfer Your Project Code to AWS EC2

You have 2 easy options:

#### Option A: Clone from your GitHub repository (Recommended)
```bash
# In the EC2 terminal:
git clone <YOUR_GITHUB_REPO_URL> ccmrs
cd ccmrs
npm install --production
```

#### Option B: Direct Copy from your Mac via SCP
```bash
# Run this on your Mac Terminal (from your project directory):
scp -i ~/Downloads/ccmrs-key.pem -r . ubuntu@<YOUR_EC2_PUBLIC_IP>:~/ccmrs
```

---

### Step 6: Configure Environment Variables (`.env`)

On the EC2 server inside `~/ccmrs`:
```bash
cat << 'EOF' > .env
PORT=5001
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
DISCORD_BOT_TOKEN=your_discord_bot_token_here
GEMINI_API_KEY=your_gemini_api_key_here
EOF
```

---

### Step 7: Launch CCMRS with PM2 (24/7 Continuous Background Running)

```bash
# Start CCMRS with PM2
pm2 start server.js --name "ccmrs-production"

# Save PM2 process list
pm2 save

# Enable PM2 to auto-start if EC2 server ever reboots
pm2 startup
```
*(Copy and paste the `sudo env PATH=...` command that `pm2 startup` displays if prompted).*

---

### Step 8: (Optional) Map Standard Port 80 to Port 5001 with Nginx

If you want users/professors to access `http://<YOUR_EC2_IP>` without typing `:5001`:

```bash
sudo apt install -y nginx

sudo bash -c 'cat > /etc/nginx/sites-available/default << "EOF"
server {
    listen 80 default_server;
    listen [::]80 default_server;

    location / {
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF'

sudo nginx -t
sudo systemctl restart nginx
```

---

## 🌐 Verification & Live Demonstration

Open your browser and navigate to:
* **With port:** `http://<YOUR_EC2_PUBLIC_IP>:5001/index.html`
* **With Nginx:** `http://<YOUR_EC2_PUBLIC_IP>/index.html`

### What is Live:
1. **Telegram Bot `@ccmrs_bot`**: Polling and answering customer messages 24/7 from AWS.
2. **Discord Bot `CCMRS Bot#8660`**: Connected to Discord Gateway from AWS.
3. **Web Portal**: Accessible globally on your public AWS EC2 IP.
4. **SLA Background Engine**: Polling tickets and triggering escalations in AWS cloud.
5. **Customer Digital Wallet & AI Drafts**: Operating in the cloud.
