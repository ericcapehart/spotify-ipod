# iPod Classic for Spotify

A web app that turns an old Android phone (Android 5.1, Chrome 88) into an iPod Classic look-alike:
a click wheel, the classic menus, and a Now Playing screen, using the music library of your Spotify account.

Files: `index.html`, `style.css`, `app.js`, `manifest.json`. No build step and no server code.

## How it plays music

The page is a **remote control**. Audio comes from a **Spotify Connect device**: the Spotify app on
the same phone, or a speaker, PC, TV or car. Spotify's in-browser player isn't supported on mobile
browsers, so the page can't produce audio on its own. If Spotify's browser player does start on the
phone, it shows up as "iPod Classic (this browser)" under Settings › Play On, but don't count on it.

Requirements:
- **Spotify Premium** on the account you log in with. Spotify only lets Premium accounts control playback.
- The **Spotify app running somewhere** (on this phone or another device) when you press play.
  If it's on the same phone, open Spotify once and then switch back to the iPod page.

## 1. Create a Spotify app (one time)

1. Go to <https://developer.spotify.com/dashboard> and log in. Under Spotify's rules, the account that
   owns the app needs Premium.
2. Click **Create app**. Under APIs, tick **Web API** and **Web Playback SDK**.
3. Under **Redirect URIs**, add the exact address where you'll host the page, ending in `/`. For example:
   `https://yourname.github.io/ipod/`
4. Save, then copy the **Client ID**.
5. Under **User Management**, add the email of every Spotify account that will log in. In development
   mode, Spotify allows up to 5 users.

## 2. Host it over HTTPS

Spotify only accepts `https://` redirect addresses, apart from `http://127.0.0.1` for local testing.
Either of these free options works:

- **GitHub Pages:** create a repo, upload the four files, then enable Settings › Pages.
- **Netlify Drop:** drag the folder onto <https://app.netlify.com/drop>.

Optional: put your Client ID in `CLIENT_ID` at the top of `app.js` so you don't have to type it on the phone.

## 3. On the phone

1. Open the address in Chrome, enter the Client ID (if you didn't hard-code it), and tap **Log in with Spotify**.
2. Chrome menu › **Add to Home screen**. Launching from the home-screen icon runs it full screen.
3. Open the Spotify app once so it shows up as a device. Then choose music on the iPod.

### If Spotify's login page won't load on the phone

Spotify's login page doesn't support old versions of Chrome. Sign in on another device and hand the login over:

1. On a computer (or any phone with a current browser), open the same address, enter the Client ID,
   and tap **Log in for another device**.
2. After you sign in to Spotify, that device shows a QR code. On the old phone, tap **Scan login code**
   and point the camera at it. If the camera doesn't work, use **Copy link** on the computer, send the
   link to the phone yourself, and open it in Chrome.

The code works like a password for your Spotify account, so keep it private. Don't open the link on the
computer: Spotify issues a new refresh token each time one is used, and the phone needs to be the only
device using it.

Without an account, **Try demo library** shows the full UI with a made-up library and a simulated player.

## Controls

| Control | In menus | On Now Playing |
|---|---|---|
| Spin the wheel | Move the selection | Volume. After pressing center, it scrubs through the song |
| Center button | Open or play | Switch between volume and scrubbing |
| MENU | Go back | Go back |
| ▶❚❚ / ◀◀ / ▶▶ | Play/pause, previous, next | Same |

You can also tap a menu row directly. Settings has Play On (device picker), Shuffle, Repeat,
Theme (Silver or Black), Clicker sound, and Log Out.

## Library and Spotify's limits

- **Songs** = your Liked Songs. **Albums** = your saved albums. **Artists** = the artists you follow,
  which lead to their albums.
- **Playlists:** under Spotify's February 2026 rules for development-mode apps, the API only lists tracks
  for playlists you **own or collaborate on**. Other playlists show **Play** and **Shuffle Play** for the
  whole playlist.
- Playing from Songs queues up to 100 tracks starting at the one you picked. **Shuffle Songs** shuffles up
  to 250 liked songs and queues 100 of them.
