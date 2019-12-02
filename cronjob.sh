#!/bin/sh
cd ~/mf-music

git fetch
HEADHASH=$(git rev-parse HEAD)
UPSTREAMHASH=$(git rev-parse master@{upstream})

echo "\n------------"
echo "$(date)\n"
pm2 stop 0
pm2 delete 0
mpc stop

if [ "$HEADHASH" != "$UPSTREAMHASH" ]
 then
    echo -e ${ERROR}Not up to date with origin. Cloning and installing.${NOCOLOR}
    cd ~
    sh ~/mf-music/pre_update.sh
    rm -rf mf-music
    git clone https://github.com/jose-jacinto/mf-music.git
    cd ~/mf-music
    npm install
    git checkout package-lock.json
    pm2 start index.js
    pm2 save
    sh ~/mf-music/post_update.sh
 else
   echo -e ${FINISHED}Current branch is up to date with origin/master. Exiting${NOCOLOR}
   echo
   pm2 start index.js
   pm2 save
   exit 0
fi
