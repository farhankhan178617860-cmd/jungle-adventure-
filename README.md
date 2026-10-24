# 🧟 Jungle Ruins — 3D Zombie Jungle (multiplayer, phone + PC)

2–4 dost ek hi jungle mein saath ghoomte hain, zombies se ladte hain, purane ruins mein jaate hain
aur missions poore karte hain. Browser mein chalta hai (PC aur phone), install kuch nahi karna.

---

## 1. Sach batao: kya chalta hai, kya check NAHI hua

| Cheez | Haal |
|---|---|
| Server: rooms, 4 player limit, position sync, zombies, damage, kill, death, respawn, missions | ✅ `npm test` mein 40 automatic checks, baar-baar chalane par bhi pass |
| Client ka code (lobby, HUD, zombies, combat, death screen, touch controls) asli server ke saath | ✅ 40 checks (desktop + touch), lekin **nakli browser** mein (neeche dekho) |
| Online hosting ke liye files (`render.yaml`, `/health`, `PORT`, `wss://`) | ⚠️ taiyar hain, par maine khud Render par deploy karke **nahi dekha** |
| **Asli graphics** (jungle kaisa dikhta hai, perchhaiyaan, zombie ka look) | ❌ **check nahi hua.** Jahan maine ye banaya wahan Three.js download nahi ho sakta tha, to asli rendering kabhi chali hi nahi. Pehli baar aap hi dekhoge |
| **Phone par smooth chalna** (FPS) | ❌ **check nahi hua.** Phone ke liye halka mode, saste pedh, kam resolution, auto-resolution aur touch controls bane hain, par asli phone par naapa nahi gaya. Sirf andaaza (hisaab se, naapa nahi): "Halka" mode mein poore map ke kareeb 2 lakh triangle aur ~240 draw call hain, aur camera ke saamne ka hissa hi banta hai, to mid-range phone ke liye theek hona chahiye. Purane / sasta phone par atak sakta hai |
| iPhone / Safari | ❌ check nahi hua (fullscreen button iPhone par nahi aata, "Add to Home Screen" use karo) |
| **Text chat** (likh kar baat): PC par `Enter`, phone par 💬 button + 1-tap phrases | ✅ server aur client dono ke tests pass (sabko dikhta hai, 120 akshar, spam rokta hai). Asli phone ke keyboard par check nahi hua |
| **App ki tarah install karna** (home-screen icon, fullscreen, landscape) | ✅ asli Chromium browser mein check hua: manifest sahi, icons sahi, service worker chalu, offline mein bhi page khulta hai. ⚠️ Asli Android / iPhone par install karke maine nahi dekha |
| **APK file / Play Store app** | ❌ **nahi bani.** Iske liye Android ke tools aur game ka online (https) hona chahiye. Rasta sec. 4 mein hai, par wo maine chalaya nahi |
| **Voice chat** (bol kar baat) | ❌ **nahi hai.** Iske liye WebRTC aur alag server chahiye. Abhi ke liye game ke saath WhatsApp / Discord call chalu rakho |
| Awaaz (sound / music), save, login | ❌ nahi hai |

"Nakli browser" ka matlab: test mein asli `main.js` Node mein chalta hai, nakli screen aur nakli Three.js ke saath.
Isse pakda jaata hai ki client aur server ek-doosre ki baat samajhte hain aur code mein koi error nahi.
Ye nahi bata sakta ki tasveer sundar dikhti hai ya phone par tez chalti hai.

**Graphics "photo jaise" nahi hain.** Ye stylized-realistic jungle hai (andhere-dhundhle jungle ki roshni, dhundh,
ghane pedh, perchhaiyan). Texture code se bante hain. Asli photo-realism ke liye bahar ke art assets chahiye (neeche sec. 8).

---

## 2. Computer par chalana (pehle yahi karo)

1. **Node.js 20 ya naya** install karo: https://nodejs.org (LTS). `node -v` se check karo.
2. ZIP ko **Extract / Unzip** karo, us folder mein terminal kholo.
3. Ye likho:
   ```
   npm install
   npm start
   ```
   `npm install` sirf Three.js laata hai (isse game tez khulta hai aur sab kuch apne server se aata hai).
   Bina `npm install` ke bhi chalta hai, tab Three.js internet (CDN) se aata hai.
4. Browser mein **http://localhost:3000** kholo. Naam likho, **"नया रूम बनाओ"** dabao.
   Upar left mein 4 akshar ka **room code** dikhega.
5. Dost: ek hi WiFi par ho to terminal mein dikhe `http://192.168.x.x:3000` kholo, code daalo, **"जुड़ो"** dabao.
   Door ke dost ke liye game ko online karo (sec. 3).

Akele test karna ho to ek browser ke do tab kholo: ek mein room banao, doosre mein code se judo.

## 3. Game ko online karna (Render, step-by-step)

Dosto ko link bhejne ke liye game ko internet par ek server chahiye. Ye guide **Render** ka free plan use karti hai.
(Koi bhi Node.js hosting chalegi jahan `npm install` aur `npm start` chal sakein. Render ke buttons ke naam
kabhi-kabhi badal jaate hain, to thoda alag dikhe to ghabrao mat.)

**Free plan ki sachchai** (Render ke docs ke hisaab se, https://render.com/docs/free, 15 Oct 2026 ko dekhe):
- 15 minute tak koi traffic na ho to server **so jaata hai**. Phir pehli baar kholne par ~1 minute lagta hai jagne mein.
  Khelte waqt WebSocket ka traffic server ko jagaye rakhta hai.
- Server so jaye ya restart ho to **saare rooms mit jaate hain** (naya room banana padega).
- Mahine mein 750 free ghante milte hain. Docs khud kehte hain ki free service production ke liye nahi hai.
- Bandwidth ki bhi seema hai. Seema paar hone par (bina payment card ke) free services mahine ke baaki din ke liye ruk sakti hain.

**Step 1: Code GitHub par daalo** (computer par karna sabse aasan)
1. https://github.com par free account banao.
2. **New repository** banao (naam: `jungle-ruins`, Public ya Private, dono chalega).
3. **"uploading an existing file"** (ya Add file → Upload files) dabao.
4. ZIP ko **pehle extract karo**, phir folder ke **andar ki saari files aur folders** (`server`, `shared`, `public`, `test`,
   `package.json`, `render.yaml`, `README.md` ...) drag karke daalo. **ZIP file ko khud upload mat karo**, GitHub use khol nahi sakta.
   `package.json` repository ke sabse upar (root mein) dikhna chahiye, kisi folder ke andar nahi.
5. **Commit changes** dabao.

**Step 2: Render par chalao**
1. https://render.com par GitHub se sign up karo.
2. **New +** → **Blueprint** → apni `jungle-ruins` repository chuno → **Apply**.
   (Blueprint `render.yaml` se sab settings khud bhar deta hai.)
   Agar Blueprint na dikhe: **New +** → **Web Service** → repository chuno, aur ye bharo:
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
   - Health Check Path: `/health`
3. Deploy hone do (kuch minute). Upar tumhara link aayega, jaise `https://jungle-ruins-zombies.onrender.com`.
4. Link ko **phone aur PC** par kholo. **"नया रूम बनाओ"** dabao.
5. Upar **🔗** button se join-link copy karo (`...?room=ABCD`) aur dosto ko bhejo. Dost link kholega to code khud bhara milega.

**Update karna ho:** GitHub par files badlo, Render khud dobara deploy kar deta hai.

## 4. Phone par khelna

- Phone ko **aada (landscape)** karo. Seedha rakhne par upar "phone aada karo" likha aata hai.
- **Left angutha:** jahan chhuo wahan joystick banta hai. Kinare tak dhakelo to **daudna**.
- **Right angutha:** ghoom kar dekhna. Buttons: **⚔** vaar, **⤒** kudna.
- **💬** (upar left, room code ke paas): likh kar doston se baat karo. Keyboard na kholna ho to neeche ke 1-tap buttons dabao (🆘 मदद!, 👉 इधर आओ, 🧟 ज़ॉम्बी आ रहे हैं! ...). Naye sandesh screen ke left mein kuch der dikhte hain.
- Lobby mein **Graphics quality**: Auto (phone par halka), Achhi, Madhyam, Halka. Phone dheema chale to **Halka** chuno.
  Game FPS girne par resolution khud bhi ghata deta hai.
- Agar tumhara browser fullscreen support kare to upar ⛶ button dikhta hai. iPhone par ye nahi aata: Safari mein Share → **Add to Home Screen**, wahan se kholo (ye bhi check nahi hua).
- PC par touch screen test karna ho to address ke end mein `?touch=1` lagao.

### App ki tarah install karna (home-screen icon, fullscreen)

Game ko phone par alag "app" icon ki tarah rakh sakte ho. Ye browser ki install suvidha hai (PWA), play store wali APK nahi.
**Zaroori:** game ka link **https** wala ho (Render ka link hota hai). Ghar ke WiFi wala `http://192.168...` link install nahi hota.

- **Android (Chrome):** online link kholo. Lobby mein **"📲 फ़ोन पर ऐप की तरह इंस्टॉल करो"** button aayega, use dabao. Na aaye to Chrome ka menu (⋮) → **Install app** / **Add to Home screen**.
- **iPhone (Safari):** link Safari mein kholo → neeche **Share (⬆)** → **Add to Home Screen**. (Chrome se iPhone par ye nahi hota.)
- Home-screen ke icon se kholne par game **fullscreen aur landscape** mein khulta hai.
- App ko bhi **internet aur server** chahiye. Offline sirf lobby khulta hai, khel nahi sakte.
- Update karne par app khud nayi files le leta hai (service worker pehle network se laata hai).

**Asli APK chahiye?** (check nahi kiya) Game online hone ke baad https://www.pwabuilder.com par apna link daalo, **Package for stores → Android** chuno. Wo APK banata hai. PWABuilder ke docs ke hisaab se APK **signed** hona chahiye (uske Android Options mein signing chuno) aur `assetlinks.json` apni site ke `/.well-known/` mein daalni padti hai, warna app ke upar browser ka address bar dikhta hai. Phone mein APK ko "unknown apps se install" ki ijazat dekar install kar sakte ho. Play Store par daalne ke liye Google Play Console ka developer account chahiye.

## 5. Khel ke niyam

- Missions (poori team ke liye saajha): **5 purane avashesh** uthao, **5 ruins** mein jao, **15 zombies** maaro.
- Zombie 2 vaar mein girta hai. Paas aakar wo pehle haath uthata hai (0.5 second), phir kaatta hai (12 nuksaan, har 1.1 second mein).
  Tumhare vaar se wo thodi der ruk jaata hai aur peeche dhakel diya jaata hai.
- Tum chalte ho 5.2 m/s, daudte ho 9 m/s. Zombie 3.4 m/s, to daudkar hamesha bach sakte ho. Kaafi door jaoge to wo peecha chhod deta hai.
- Health 0 ho to 6 second zameen par, phir shuru wali jagah par wapas (3 second tak koi nuksaan nahi). 6 second bina chot ke health khud badhne lagti hai.
- Zombie girne par 20 second baad door kisi jagah naya aa jaata hai. Doston ko "revive" karne wala feature abhi nahi hai.

**PC controls:** `W A S D` chalo · `Shift` daudo · `Space` kudo · `F` ya click = vaar (pehle click karke mouse pakdo) · `Enter` = chat (likh kar `Enter` bhejo, `Esc` band) · mouse se dekho ·
`Q`/`E` camera ghumao · scroll = zoom.

## 6. Dikkat aaye to

| Dikkat | Hal |
|---|---|
| Kaali screen / "WebGL" error | Browser update karo, hardware acceleration chalu karo. Chrome, Edge, Firefox, Safari ke naye version |
| Online link khulne mein 1 minute lagta hai | Free server so gaya tha. Intezaar karo, khelte waqt dobara nahi sota |
| "Connection toot gaya" | Server restart hua ya phone ki screen band hui. Page reload karo (room mit gaya ho to naya banao) |
| "ऐसा कोई रूम नहीं मिला" | Code galat hai, ya server restart hone se room mit gaya |
| Phone dheema / atakta hai | Lobby mein Graphics quality = **Halka**. Doosre tab band karo |
| Port 3000 pahle se use mein hai | `PORT=3001 npm start` (Windows PowerShell: `$env:PORT=3001; npm start`) |
| Kuch toota hua dikhe | Browser mein F12 → Console ka error mujhe bhej do |

## 7. Folder ka dhancha

```
server/   index.js (web + WebSocket server)  rooms.js (rooms, damage)  zombies.js (zombie AI)
          missions.js (missions server par jaanche jaate hain)  ws.js (chhota WebSocket, bina library)
shared/   config.js (game ke saare numbers: zombie, player, missions)  worldgen.js (seed se pura jungle)  missions.js
public/   index.html, style.css, manifest.webmanifest (app info), sw.js (service worker), icons/  js/: main.js (game loop)  world.js (pedh, ruins, vines)  zombie.js  avatar.js
          controls.js (keyboard + touch)  quality.js (halka/madhyam/achha)  lighting.js  ui.js  net.js ...
test/     smoke.js (server)  client-stub.js (client, nakli browser)  three-stub.js, fake-dom.js, stub-loader.js
render.yaml  package.json
```

**Game balance badalna:** `shared/config.js` kholo, number badlo (zombie ki taadaad, nuksaan, speed, health, kill-goal ...),
server dobara chalao. Server aur client dono wahi file padhte hain.

**Multiplayer kaise chalta hai:** server har room ka ek **seed** chunta hai, sirf wahi sabko bhejta hai, aur har phone/PC
`shared/worldgen.js` se **ek jaisa jungle** khud bana leta hai. Har player ki position 15 baar/second jaati hai.
**Zombies, nuksaan, kills aur missions sirf server tay karta hai**, client sirf dikhata hai.

## 8. Agla kya (aur sachchi seemayein)

- **Photo jaise graphics:** `public/js/textures.js` ki jagah asli PBR textures (ambientCG, Poly Haven par muft), `world.js` ke pedhon ki
  jagah GLTF models, `avatar.js`/`zombie.js` mein skin wale characters (Mixamo), HDRI aasman. Phone par bhaari padega, to quality presets ke saath.
- Chalne ki position **client** tay karta hai (server sirf seema jaanchta hai). Dost-mitron ke khel ke liye theek hai, cheating rokne ke liye
  server-side physics chahiye.
- Zombies seedhe player ki taraf chalte hain. Kabhi-kabhi pedh ya ruins ke peeche atak sakte hain (raasta dhoondhne wala AI nahi hai).
- Server par ek saath max 40 room, har room mein max 4 player.
- Naye feature: dushman ke naye type, hathiyaar, items, bada map, awaaz, voice chat. `shared/missions.js` mein naya mission jodo
  (+ `server/missions.js` mein jaanch), zombie ke liye `server/zombies.js`.
