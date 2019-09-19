const https = require('https');
const Lecmd = require('node-cmd');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const io = require('socket.io-client');

const getSize = require('get-folder-size');

const default_volume = 75;
const spot_volume = 95;

const mpd = require('mpd'),
  cmd = mpd.cmd
  const mpdClient = mpd.connect({
  port: 6600,
  host: 'localhost',
});

mpdClient.on('ready', function() {
  console.log("MPD Client is Ready");
});

const pharmacy = require('/boot/pharmacy.json');

const socket = io( (pharmacy.env === "PROD") ? 'https://servicos.maisfarmacia.org' : 'http://192.168.2.102:9012', { path: '/piradio' });
console.log(  (pharmacy.env === "PROD") ? 'Started In PROD' : 'Started In DEV' )


let connected = false;
let playing = false;
let interval = null;
const amixerArray = ['-c', '0', '--', 'sset', 'PCM', 'playback'];

// helper function that gets the songs from the url
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      switch(res.statusCode) {
      case 200:
        resolve(res);
        break;
      case 302: // redirect
        resolve(httpGet(res.headers.location));
        break;
      default:
        reject(`Failed to fetch song at ${url}`);
      }
    });
  });
}

// this function recursively lists files in a directory
const listFiles = (dir, done) => {
  let results = [];

  fs.readdir(dir, (err, list) => {
    if (err) return done(err);

    let pending = list.length;
    if (!pending) return done (null, results);

    list.forEach((file) => {
      file = path.resolve(dir, file);
      fs.stat(file, (err, stat) => {
        if (stat && stat.isDirectory()) {
          listFiles(file, (err, res) => {
            results = results.concat(res);
            if (!--pending) done(null, results);
          });
        } else {
          results.push(file);
          if (!--pending) done(null, results);
        }
      });
    });
  });
};

// determine whether to delete whole cache or not based on cache size
let deleteAll = false;
fs.stat('../cache', (err) => {
  if (!err) {
    getSize('../cache', (err, size) => {
      if (err) {
        console.error(err);
        process.exit();
      } else if (size > 4000000000) {
        deleteAll = true;
      }
    });
  }
});

// since the process is restarted everyday by a system cronjob
// remove the songs that have been cached over a month on restart
// or if the cache size exceeds 4GB
fs.stat('../cache', (err) => {
  if (!err) {
    listFiles('../cache', (err, files) => {
      files.forEach((file) => {
        fs.stat(file, (err, stat) => {
          if (err) {
            console.error(err);
          } else {
            const { birthtime } = stat;
            const now = new Date();

            if (deleteAll || now.getMonth() - birthtime.getMonth() > 0) {
              try {
                fs.unlinkSync(file);
              } catch (error) {
                console.error(error);
              }
            }
          }
        });
      });
    });
  }
});

// ! event: started
// mpvPlayer.on('started', async () => {
//   playing = true;
//   const songName = await mpvPlayer.getProperty('media-title');
//   const songPath = await mpvPlayer.getProperty('path');
//   console.log(`${pharmacy.ANF}: playing ${songName}`);

  // // emit info to server so that pharmacy radio data is updated
  // socket.emit('playing', pharmacy.ANF, { src: songPath });

//   // if about to play a commercial, raise the volume, otherwise lower it
//   if (songName.indexOf('Spot') !== -1) {
//     spawn('amixer', [...amixerArray, '-1dB']);
//   } else {
//     spawn('amixer', [...amixerArray, '-3dB']);
//   }

//   // If the song is not cached and there are less than 4GB of cached songs, cache it
//   if (songPath.indexOf('http') !== -1) {
//     fs.stat('../cache', (err) => {
//       if (err) {
//         fs.mkdirSync('../cache');
//       }

//       getSize('../cache', async (err, size) => {
//         if (err) {
//           console.error(err);
//         } else  if (size < 4000000000) {
//           const playlistDir = `../cache/${songPath.split('/')[4]}`;
//           if (!fs.existsSync(playlistDir)) fs.mkdirSync(playlistDir);

//           const songFile = fs.createWriteStream(`${playlistDir}/${await mpvPlayer.getProperty('filename')}`);
//           httpGet(songPath)
//             .then(response => response.pipe(songFile))
//             .catch((err) => {
//               fs.unlinkSync(`${playlistDir}/${songName}`);
//               console.error(err);
//               if (err.message.indexOf('Failed') === -1) {
//                 process.exit();
//               }
//             });
//         }
//       });
//     });
//   }
// });

// ! when playback events occurs, inform server so that database info is updated
// mpvPlayer.on('paused', () => socket.emit('paused', pharmacy.ANF));
// mpvPlayer.on('stopped', () => socket.emit('stopped', pharmacy.ANF));
// mpvPlayer.on('resumed', () => socket.emit('resumed', pharmacy.ANF));

let changesBuffer = null

mpdClient.on('system-player', function() {
  mpdClient.sendCommand(cmd("currentsong", []), function(err, msg) {
    if (err) throw err;
    let myCurrentSong = msg.split('\n')[0].split('file: ')[1];
    if(myCurrentSong !== undefined) changesBuffer = myCurrentSong;
  });
});

setInterval( () => {
  if(changesBuffer !== null) {
    console.log(`Changed to a new song ${changesBuffer}`);

    if (changesBuffer.indexOf('Spot_') !== -1) {
      Lecmd.run(`mpc volume ${spot_volume}`);
      console.log(`Changed to volume ${spot_volume} playing a Spot`)
    } else {
      Lecmd.run(`mpc volume ${default_volume}`);
     // console.log(`Changed to volume ${default_volume}`)
    }

    socket.emit('playing', pharmacy.ANF, { src: changesBuffer});

    if (changesBuffer.indexOf('http') !== -1) {
      fs.stat('../cache', (err) => {
        if (err) {
          fs.mkdirSync('../cache');
        }
  
        getSize('../cache', async (err, size) => {
          if (err) {
            console.error(err);
          } else  if (size < 4000000000) {
            console.log('Have space for new music in cache : TRUE');
            console.log(`Caching ${changesBuffer}`);
            const playlistDir = `../cache/${changesBuffer.split('/')[4]}`;
            if (!fs.existsSync(playlistDir)) fs.mkdirSync(playlistDir); // Created the directory if not exist
  
            const songFile = fs.createWriteStream(`${playlistDir}/${changesBuffer.split('/')[5]}`); //Write it now
            httpGet(changesBuffer)
              .then(response => {
                response.pipe(songFile);
                changesBuffer = null;
              })
              .catch((err) => {
                fs.unlinkSync(`${playlistDir}/${changesBuffer.split('/')[5]}`);
                console.error(err);
                changesBuffer = null;
                if (err.message.indexOf('Failed') === -1) {
                  process.exit();
                }
              });
          }
        });
      });
    }else{
      changesBuffer = null;
    }
  }
},500)

// event: on connect
socket.on('connect', () => {
  console.log(`${pharmacy.ANF}: Connected to main server, setting defaults`);
  connected = true;
  Lecmd.run(`mpc volume ${default_volume}`);
  Lecmd.run(`mpc random off`);
  Lecmd.run(`mpc repeat on`);
  
  if (interval !== null) {
    clearInterval(interval);
  }

  // inform the server, so that it may assign it to its particular room
  socket.emit('joinRoom', pharmacy.ANF);
});

// event: on disconnect
socket.on('disconnect', () => {
  console.log(`${pharmacy.ANF}: Disconnected from server. Trying to reconnect...`);
  connected = false;

  // try to reconnect to the server
  socket.open();
  
  // until the device has reconnected, try to connect every 5 seconds
  interval = setInterval(() => {
    if (!connected) socket.open();
  }, 5000);
});

// event: on play
socket.on('play', (msg) => {

  mpdClient.sendCommand(cmd("clear", []), function(err, result) {
    if (err) throw err;
  });

  if (playing) {
    console.log(`${pharmacy.ANF}: received request to play from server. Restarting playlist or playing new one from the beginning`); 
  } else {
    console.log(`${pharmacy.ANF}: received request to play from server`);
  }

  // build a playlist where the URL of a song is a file if it is cached or an URL otherwise
  playlist = msg.playlist;
  const finalPlaylist = [];

  msg.playlistLocal.forEach((url, index) => {
    try {
      if (fs.statSync(url).size === 0) { // if the file does not exist or is empty
        // console.log(`NOT playing from cache ${msg.playlist[index]}`)
      } else {
        console.log(`playing from cache ${path.resolve(__dirname,url.replace(/(\s+)/g, '\\$1'))}`)
        finalPlaylist.push(url);

        Lecmd.run(`mpc add ${path.resolve(__dirname, url).replace(/(\s+)/g, '\\$1')}`);
      }
    } catch (err) { // don't know why try catch. Find out and leave comment with reason why
      finalPlaylist.push(msg.playlist[index]);
      mpdClient.sendCommand(cmd("add", [msg.playlist[index].replace(/\s/g, '+')]), function(err, result) {
        if (err) throw err;
      });
    }
  });
  Lecmd.run(`mpc play`); // play the playlist now

});

// event: on stop
socket.on('stop', () => {
  if (!playing) {
    console.log(`${pharmacy.ANF}: received request to stop from server, but was already stopped`);
  } else {
    console.log(`${pharmacy.ANF}: received request to stop from server`);
  }

  playing = false;
  if (interval !== null) clearInterval(interval);

  mpdClient.sendCommand(cmd("clear", []), function(err, result) {
    if (err) throw err;
    socket.emit('stopped', pharmacy.ANF);
  });
});

// event: on pause
socket.on('pause', () => {
  console.log(`${pharmacy.ANF}: received request to pause from server`);
  paused = true;
  mpdClient.sendCommand(cmd("pause", []), function(err, result) {
    if (err) throw err;
    socket.emit('paused', pharmacy.ANF);
  });
});

// event: on resume
socket.on('resume', () => {
  console.log(`${pharmacy.ANF}: received request to resume from server`);
  paused = false;

  mpdClient.sendCommand(cmd("play", []), function(err, result) {
    if (err) throw err;
    socket.emit('resumed', pharmacy.ANF);
  });
});

// event: on next
socket.on('next', () => {
  console.log(`${pharmacy.ANF}: received request to skip from server`);
  mpdClient.sendCommand(cmd("next", []), function(err, result) {
    if (err) throw err;
    console.log(result);
  });
});

// comments that applied to "socket.on('play')" are applied here
socket.on('shuffle', (msg) => {
  if (playing) {
    console.log(`${pharmacy.ANF}: received request to play from server. Restarting playlist or playing new one from the beginning`); 
  } else {
    console.log(`${pharmacy.ANF}: received request to play from server`);
  }
  Lecmd.run(`mpc play`);
});