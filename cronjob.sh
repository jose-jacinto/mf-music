#!/bin/sh
echo "\n------------" &&
echo "$(date)\n" &&
pm2 stop 0 &&
pm2 delete 0 &&
mpc stop &&
cd ~ &&
rm -rf mf-music &&
git clone https://github.com/jose-jacinto/mf-music.git &&
#sudo apt-get update &&
#sudo apt-get install -y mpv &&
cd ~/mf-music &&
npm install &&
git checkout package-lock.json &&
pm2 start index.js &&
pm2 save