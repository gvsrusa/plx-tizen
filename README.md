# PlxTizen

An unofficial, lightweight [Plex](https://www.plex.tv/) client for Samsung Tizen TVs, inspired by
[PlxNative](https://github.com/GLinnik21/plx-native) (which does the same for LG webOS).

No framework, no build step: three files (`index.html`, `app.js`, `style.css`) that run on the
TV's built-in browser engine. Video plays through the TV's own `<video>` decoder.

Not affiliated with Plex, Inc. or Samsung.

## Features

- Sign in on the TV with a 4-character code at [plex.tv/link](https://plex.tv/link)
- Picks the fastest connection to your server (local, remote or relay); choose between several servers
- Home hubs (Continue Watching, Recently Added), movie and TV libraries, search
- Shows → seasons → episodes
- Direct play for MP4/MOV with H.264/HEVC; everything else via Plex HLS transcode, with automatic
  fallback if direct play fails
- Resume, seek (←/→ 10 s, ⏪/⏩ 30 s), play/pause, progress reported back to the server
- D-pad spatial navigation, Back key, media keys

Not yet: Plex Home profile switching, audio/subtitle track menus (subtitles are burned in when
transcoding), Up Next, music/photos.

## Run in a desktop browser

```sh
python3 -m http.server 8080   # then open http://localhost:8080
```

Arrow keys navigate, Enter selects, Esc/Backspace is Back.

## Install on a Samsung TV

1. Install [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)
   with the TV extensions, and create a Samsung certificate profile in Certificate Manager.
2. On the TV: **Apps** → type `12345` on the remote → turn **Developer mode** on and enter your
   computer's IP. Restart the TV.
3. Package and install:

```sh
sdb connect <TV_IP>
tizen package -t wgt -s <your-cert-profile> -- .
tizen install -n PlxTizen.wgt -t <device-name-from-sdb-devices>
```

## Test

```sh
node test.js
```

## Compatibility

Written in ES2017 without CSS grid or flex `gap`, so it should run on Tizen 4.0+ (2018 sets).
