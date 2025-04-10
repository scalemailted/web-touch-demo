# Node.js Remote Web Controller and Display

This project implements a real-time interactive system using Node.js, Express, and Socket.IO. It allows a web page (`controller.html`), typically opened on a touch device, to act as a remote control (virtual trackpad and **mobile-style keyboard**) for another web page (`app.html`) displayed elsewhere. The app page displays a virtual cursor, interactive elements receive hover and focus indicators based on the remote cursor's position and actions, and a QR code enables easy controller access.

**Core Functionality:**

-   Use your phone/tablet (`controller.html`) as a wireless trackpad to move a virtual cursor (red dot) on `app.html`.
-   As the virtual cursor moves over interactive elements on `app.html`, they receive a **green outline or underline hover effect**.
-   **Tap (single-finger) or right-click** on the controller's touch surface to simulate clicks on `app.html`. A **two-finger tap** also triggers a click.
-   When a tap focuses a text input field (`<input type="text">` or `<textarea>`) on `app.html`, a **blue outline appears** around that field.
-   The controller page features an **always-visible virtual keyboard optimized for mobile**, with separate layers for letters and numbers/symbols, toggled by mode keys. It includes **Shift functionality** within the letters layer.
-   Use the controller's virtual keyboard to type directly into the text field currently focused (and outlined) on `app.html`.
-   The app page (`app.html`) displays a **QR code** for quick connection to the controller page.

**Components:**

-   **Server (`server.js`):** Node.js + Express + Socket.IO server. Manages connections, relays events (`cursor_move`, `tap`, `key_input`), serves static files.
-   **App Display (`public/app.html`):** The target web page (root URL `/`). Connects as 'app'. Displays the virtual cursor. Receives remote events. Manages visual hover (`.manual-hover`) and focus (`.manual-focus`) states. Includes demo form elements. Generates controller QR code.
-   **Touch Controller (`public/controller.html`):** The remote control interface (URL `/controller`). Connects as 'controller'. Captures touch/mouse gestures -> `cursor_move`, `tap`. Displays **always-visible, multi-layer virtual keyboard optimized for portrait mode, with mode switching (?123/ABC) and Shift (⇧).** Sends `key_input` events based on the active layer and shift state.

---

## Features

-   **Real-time Interaction:** Low-latency control via WebSockets.
-   **Full Page Remote Control:** Virtual trackpad for `app.html`.
-   **Visual Hover Indication:** Green outline/underline on interactive elements in `app.html` when hovered.
-   **Remote Click/Interaction Simulation:** Single-finger tap, two-finger tap, or right-click triggers focus/click on `app.html`.
-   **Visual Focus Highlighting for Text Inputs:** Blue outline on text fields/areas in `app.html` when focused.
-   **Mobile-Optimized Virtual Keyboard:**
    -   Always visible on the controller.
    -   **Multiple Layers:** Separate views for Letters (QWERTY) and Numbers/Symbols, improving usability on smaller screens.
    -   **Mode Switching Keys:** Easily toggle between keyboard layers (e.g., "?123", "ABC").
    -   **Toggleable Shift Key (⇧):** In the letters layer, changes case. (Currently implements momentary shift).
-   **Remote Text Input:** Types into focused text fields on `app.html`, respecting keyboard layer and Shift state.
-   **QR Code for Controller Access:** Easy mobile connection.
-   **Dynamic Cursor Visibility:** Cursor visible only when a controller is active.
-   **Improved Mobile Touch Handling:** Reliable single-tap detection.
-   **Label Click/Hover Handling.**
-   **Separation of Concerns & Heroku Ready.**

---

## Installation

### Prerequisites

-   **Node.js and npm**
-   **Git** (Optional)

### Steps

1.  **Clone/Download** the repository.
    ```bash
    git clone <your-repo-url>
    cd <your-project-folder>
    ```
2.  **Install Dependencies:**
    ```bash
    npm install
    ```

---

## Running Locally

1.  **Start the Server:**
    ```bash
    npm start
    # Or for development:
    # npm run dev
    ```
    Server starts (usually `http://localhost:3000`).

2.  **Open the App Display:**
    Navigate desktop browser to: `http://localhost:3000/`
    (Note the QR code).

3.  **Open the Touch Controller:**
    *   **QR Code:** Scan the code on the app display with your mobile device (same network).
    *   **Manual URL:** On mobile device browser, navigate to `http://<your-server-ip>:3000/controller` (replace `<your-server-ip>`).

4.  **Interact:**
    -   Controller connects -> red cursor appears.
    -   **Move Cursor:** Drag with **one finger** on the controller's touch area.
    -   **Observe Hover:** Interactive elements on `app.html` get a **green outline/underline**.
    -   **Simulate Click / Focus:** **Tap quickly with one finger** on controller's touch area (or right-click/two-finger tap). Element under cursor on `app.html` is focused/clicked.
    -   **Observe Focus:** Tap a text field -> it gets a **blue outline**.
    -   **Switch Keyboard Mode:** Tap the **"?123"** key to switch to numbers/symbols. Tap **"ABC"** to switch back to letters.
    -   **Toggle Shift:** While in the *letters* layer, tap **Shift (⇧)** to type one uppercase character (momentary shift).
    -   **Type Text:** After tapping a text field (blue outline), use the controller keyboard (in the appropriate mode). Text appears in the outlined field.
    -   Tap outside elements -> outlines disappear.
    -   Disconnect controller -> cursor and outlines disappear.

---

## Deployment to Heroku

(Standard Heroku Node.js deployment steps)

1.  Login, Create App, Commit code (`git commit -m "Implement mobile keyboard layout"`).
2.  Push to Heroku (`git push heroku main`).
3.  Open deployed app (`heroku open`). Use QR code or manual `/controller` URL.

---

## How It Works

1.  **Connection & Registration:** Standard setup.
2.  **QR Code Generation:** `app.html` uses library on load.
3.  **Cursor Visibility:** Server manages via `show_cursor`/`hide_cursor`.
4.  **Movement & Input (Controller -> App):**
    -   Controller uses Pointer Events for drag (`cursor_move`) and single-tap (`tap`). Touch Events for two-finger tap (`tap`). Right-click -> `tap`.
    -   Controller manages internal `currentMode` ('letters', 'numbers', etc.) and `isShiftActive` states.
    -   `updateKeyboardDisplay()` function shows/hides keyboard layer divs based on `currentMode` and updates key `textContent` based on `isShiftActive` (only for letters layer).
    -   Mode switch key clicks update `currentMode`, reset `isShiftActive`, call `updateKeyboardDisplay()`.
    -   Shift key click (in letters mode) toggles `isShiftActive`, calls `updateKeyboardDisplay()`.
    -   Other key clicks check `currentMode` and `isShiftActive` to determine the correct character/command to send via `key_input`. Shift is automatically deactivated after a character key press (momentary).
    -   Server relays events to `appSid`.
5.  **App Display Interaction (`app.html`):**
    -   **On `cursor_move`:** Updates cursor position & calls `handleManualHover()` (manages `.manual-hover` class).
    -   **On `tap`:** Finds element, removes old `.manual-focus`, calls `.focus()` & `.click()`, adds `.manual-focus` class if focus succeeded on text input/area, calls `handleManualHover()`. Handles tap misses.
    -   **On `key_input`:** Modifies `.value` of `document.activeElement`.

---

## Troubleshooting

-   **Keyboard Layer Not Switching:** Check controller console logs for "Switched mode to:..." messages. Ensure `data-target-mode` attributes on mode keys match `layers` object keys in JS. Check CSS for `.keyboard-layer` and `.keyboard-layer.active`.
-   **Shift Key Not Working/Toggling (Letters Layer):** Check controller console logs for "Shift toggled: true/false". Check `updateKeyboardDisplay` function logic. Ensure Shift key has the correct ID (`shiftLetters`).
-   **Incorrect Characters Typed:** Check `data-key`/`data-shift` attributes in `controller.html`. Check logic in keyboard click handler determining `keyToSend`. Log `keyToSend` before `socket.emit`.
-   **Hover Effect (Green Outline) Issues:** Check CSS (`.manual-hover`), console logs, `handleManualHover()`, `isInteractiveForHover()` logic.
-   **Blue Outline (Focus Highlight) Issues:** Check CSS (`.manual-focus`), console logs related to adding/removing the class during `tap`. Ensure logical focus succeeds first.
-   **Cannot Type After Tapping Input:** Verify logical focus is set (`app.html` console).
-   **Buttons/Radios/Checkboxes Not Working:** Ensure `.click()` call executes in `tap` handler (`app.html`).
-   **Tap (Single/Two-Finger) Not Working:** Check controller console logs. Test on a real device for multi-touch. Verify thresholds.
-   **Movement Stuttery:** Ensure `touch-action: none;` is on `#touchSurface`.
-   **QR Code Issues:** Check library include, console errors, URL generation.
-   **Connection Issues:** Check server, IP addresses/ports, firewalls, consoles.
-   **Heroku Issues:** Use `heroku logs --tail`.