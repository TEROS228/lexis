# VPS Setup Guide for Lexis API

## 🎯 Goal
Deploy Express API server on VPS (109.123.238.213) for fast, no-cold-start performance.

## 📋 Prerequisites
- VPS: 4 vCPU, 8GB RAM, 75GB NVMe (Singapore)
- IP: 109.123.238.213
- Root access via SSH

## 🔧 Step 1: Initial VPS Setup (One-time)

SSH into your VPS:
```bash
ssh root@109.123.238.213
```

Install Node.js, PM2, and Nginx:
```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2 globally
npm install -g pm2

# Install Nginx
apt install -y nginx

# Enable PM2 startup on boot
pm2 startup systemd
# Run the command it outputs

# Create app directory
mkdir -p /var/www/lexis-api

# Create logs directory
mkdir -p /var/www/lexis-api/logs
```

## 🌐 Step 2: Configure Nginx

Copy the nginx.conf to VPS:
```bash
# On your local machine
scp nginx.conf root@109.123.238.213:/etc/nginx/sites-available/lexis-api
```

Enable the site:
```bash
# On VPS
ln -s /etc/nginx/sites-available/lexis-api /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

## 🚀 Step 3: Deploy Application

On your local machine:
```bash
chmod +x deploy-vps.sh
./deploy-vps.sh
```

This script will:
1. Package your app
2. Upload to VPS
3. Install dependencies
4. Start with PM2

## ✅ Step 4: Verify Deployment

Check if API is running:
```bash
curl http://109.123.238.213/health
# Should return: {"status":"ok","timestamp":"..."}
```

Check PM2 status:
```bash
ssh root@109.123.238.213
pm2 status
pm2 logs lexis-api
```

## 🔗 Step 5: Update Vercel

Go to Vercel Dashboard → Environment Variables:
- `VITE_API_URL` = `http://109.123.238.213/api`

Redeploy Vercel.

## 🔒 Step 6: Add Domain & SSL (Optional but recommended)

If you have a domain (e.g., api.lexis.com):

1. Point A record to 109.123.238.213
2. Install Certbot:
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.yourdomain.com
```

3. Update Vercel:
- `VITE_API_URL` = `https://api.yourdomain.com/api`

## 📊 Monitoring & Management

View logs:
```bash
pm2 logs lexis-api
pm2 logs lexis-api --lines 100
```

Restart API:
```bash
pm2 restart lexis-api
```

Update and redeploy:
```bash
# On local machine
./deploy-vps.sh
```

Monitor resources:
```bash
pm2 monit
htop
```

## 🐛 Troubleshooting

### API not responding
```bash
pm2 restart lexis-api
pm2 logs lexis-api --err
```

### Nginx errors
```bash
nginx -t
tail -f /var/log/nginx/lexis-error.log
```

### Database connection issues
```bash
# Test database connection
psql "postgresql://postgres.oonifxjccdjwkdswpedl:Zzllqqppwwaa937@aws-1-ap-south-1.pooler.supabase.com:6543/postgres"
```

### Port already in use
```bash
lsof -i :4000
kill -9 <PID>
pm2 restart lexis-api
```

## 🎉 Done!

Your API should now be running at:
- **HTTP**: http://109.123.238.213/api
- **Health**: http://109.123.238.213/health

Frontend (Vercel) will call this API directly - **no cold starts, super fast!** ⚡
