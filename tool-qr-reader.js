const qrReaderStartButton =
  document.getElementById(
    "qrReaderStartButton"
  );

const qrReaderMessage =
  document.getElementById(
    "qrReaderMessage"
  );


let qrScanner = null;

let scanning = false;

let resultAccepted = false;


/* =========================================
   QR内容確認
========================================= */

function openQrResult(
  decodedText
) {

  if (resultAccepted) return;

  let url;


  try {

    url =
      new URL(
        decodedText
      );

  } catch (error) {

    qrReaderMessage.textContent =
      "工具用QRコードではありません";

    return;
  }


  /*
    工具詳細URLか確認
  */

  if (
    !url.pathname.endsWith(
      "tool-detail.html"
    )
  ) {

    qrReaderMessage.textContent =
      "工具用QRコードではありません";

    return;
  }


  const toolId =
    url.searchParams.get(
      "id"
    );


  if (!toolId) {

    qrReaderMessage.textContent =
      "工具番号を確認できませんでした";

    return;
  }


  /*
    QR読取停止
  */

  // Lock before stopping: a pending decoder callback may still arrive.
  resultAccepted = true;
  cameraSelect.disabled = true;
  zoomInput.disabled = true;

  if (
    qrScanner &&
    scanning
  ) {

    qrScanner
      .stop()
      .catch(
        () => {}
      );
  }


  scanning =
    false;


  qrReaderMessage.textContent =
    "QRコードを読み取りました";


  /*
    ポータル内の工具詳細へ移動
  */

  window.location.href =
    `tool-detail.html?id=${encodeURIComponent(
      toolId
    )}`;
}


/* =========================================
   カメラ起動
========================================= */

const cameraControls = document.getElementById("qrCameraControls");
const cameraSelect = document.getElementById("qrCameraSelect");
const zoomControls = document.getElementById("qrZoomControls");
const zoomInput = document.getElementById("qrZoom");
const zoomValue = document.getElementById("qrZoomValue");
const zoomMessage = document.getElementById("qrZoomMessage");

let starting = false;
let cameras = [];
let activeTrack = null;
let zoomRange = null;

function isPermissionError(error) {
  return /NotAllowedError|PermissionDeniedError|SecurityError|permission denied/i.test(
    String(error?.name || "") + " " + String(error?.message || error)
  );
}

// Labels are hints, not a guarantee of lens quality. Allow manual selection too.
function preferredRearCamera(devices) {
  const rear = devices.filter(camera =>
    /back|rear|environment|背面|後面/i.test(camera.label) &&
    !/front|user|前面/i.test(camera.label)
  );
  return rear.find(camera =>
    !/ultra|tele|macro|depth|超広角|望遠|マクロ|深度/i.test(camera.label)
  );
}

function getVideoTrack() {
  return document.querySelector("#qrReader video")
    ?.srcObject?.getVideoTracks?.()[0] || null;
}

function trackSettings(track) {
  try {
    return track?.getSettings?.() || {};
  } catch {
    return {};
  }
}

function populateCameras(currentId) {
  cameraSelect.replaceChildren();
  const automatic = document.createElement("option");
  automatic.value = "";
  automatic.textContent = "背面カメラ（自動）";
  cameraSelect.append(automatic);
  cameras.forEach((camera, index) => {
    const option = document.createElement("option");
    option.value = camera.id;
    option.textContent = camera.label || `カメラ ${index + 1}`;
    cameraSelect.append(option);
  });
  cameraSelect.value = cameras.some(camera => camera.id === currentId)
    ? currentId : "";
  cameraControls.hidden = cameras.length < 2;
}

function resetZoom() {
  activeTrack = null;
  zoomRange = null;
  zoomControls.hidden = true;
  zoomInput.disabled = true;
  zoomMessage.textContent = "";
}

function safeZoom(value, range) {
  const clamped = Math.min(range.max, Math.max(range.min, value));
  const snapped = range.min +
    Math.round((clamped - range.min) / range.step) * range.step;
  const lastStep = range.min +
    Math.floor((range.max - range.min) / range.step) * range.step;
  return Number(Math.min(lastStep, Math.max(range.min, snapped)).toFixed(8));
}

function showZoom(value) {
  zoomInput.value = String(value);
  // Browser zoom units do not necessarily represent physical magnification.
  zoomValue.textContent = Number(value).toFixed(2);
}

async function configureTrack() {
  activeTrack = getVideoTrack();
  const track = activeTrack;
  if (typeof track?.getCapabilities !== "function" ||
      typeof track?.applyConstraints !== "function") return;
  let capabilities;
  try {
    capabilities = track.getCapabilities();
  } catch {
    return;
  }
  if (!capabilities) return;

  if (Array.isArray(capabilities.focusMode) &&
      capabilities.focusMode.includes("continuous")) {
    try {
      const constraints = track.getConstraints?.() || {};
      await track.applyConstraints({
        ...constraints,
        advanced: [...(constraints.advanced || []), { focusMode: "continuous" }]
      });
    } catch (error) {
      console.info("オートフォーカス指定を省略して読取を継続します", error);
    }
  }
  if (!scanning || track !== activeTrack) return;
  const zoom = capabilities.zoom;
  if (!zoom || !Number.isFinite(zoom.min) || !Number.isFinite(zoom.max) ||
      zoom.min < 0 || zoom.max <= zoom.min) return;
  const step = zoom.step === undefined
    ? (zoom.max - zoom.min) / 100 : zoom.step;
  if (!Number.isFinite(step) || step <= 0) return;
  zoomRange = { min: zoom.min, max: zoom.max, step };
  zoomInput.min = String(zoom.min);
  zoomInput.max = String(zoom.max);
  zoomInput.step = String(step);
  const current = trackSettings(track).zoom;
  showZoom(safeZoom(Number.isFinite(current) ? current : zoom.min, zoomRange));
  zoomControls.hidden = false;
  zoomInput.disabled = false;
}

async function changeZoom() {
  if (!scanning || starting || !activeTrack || !zoomRange ||
      zoomInput.disabled) return;
  const track = activeTrack;
  const previous = trackSettings(track).zoom;
  const requested = safeZoom(Number(zoomInput.value), zoomRange);
  if (!Number.isFinite(requested)) return;
  zoomInput.disabled = true;
  zoomMessage.textContent = "";
  try {
    const constraints = track.getConstraints?.() || {};
    // Replace an earlier zoom constraint rather than accumulating conflicting values.
    const advanced = (constraints.advanced || []).map(item => {
      const { zoom, ...other } = item;
      return other;
    });
    await track.applyConstraints({
      ...constraints,
      advanced: [...advanced, { zoom: requested }]
    });
    if (activeTrack === track && scanning) {
      const actual = trackSettings(track).zoom;
      showZoom(Number.isFinite(actual) ? actual : requested);
    }
  } catch (error) {
    if (activeTrack === track && scanning) {
      showZoom(Number.isFinite(previous) ? previous : zoomRange.min);
      zoomMessage.textContent = "ズームを変更できませんでした。現在の設定で読み取りを続けます。";
    }
  } finally {
    if (activeTrack === track && scanning) zoomInput.disabled = false;
  }
}

async function startQrReader(requestedId) {
  if (resultAccepted || starting || (scanning && typeof requestedId !== "string")) return;
  if (typeof Html5Qrcode === "undefined") {
    qrReaderMessage.textContent = "QR読取機能を読み込めませんでした";
    return;
  }
  starting = true;
  qrReaderStartButton.disabled = true;
  cameraSelect.disabled = true;
  resetZoom();
  qrReaderMessage.textContent = "カメラを起動しています…";
  try {
    if (scanning) {
      await qrScanner.stop();
      scanning = false;
    }
    if (!qrScanner) qrScanner = new Html5Qrcode("qrReader");
    if (!cameras.length) {
      try {
        cameras = await Html5Qrcode.getCameras();
      } catch (error) {
        if (isPermissionError(error)) throw error;
        cameras = [];
      }
    }
    const selectedId = typeof requestedId === "string"
      ? requestedId : preferredRearCamera(cameras)?.id;
    const environment = { facingMode: "environment" };
    const selected = selectedId
      ? { deviceId: { exact: selectedId } } : environment;
    const resolution = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const attempts = [
      { ...selected, ...resolution },
      ...(selectedId ? [selected, { ...environment, ...resolution }] : []),
      environment
    ];
    let lastError;
    for (const constraints of attempts) {
      try {
        await qrScanner.start(
          environment,
          {
            // Keep the existing cadence; higher fps adds load, not image detail.
            fps: 10,
            qrbox: (width, height) => {
              // Fit narrow screens and bound decoding work on larger displays.
              const side = Math.floor(Math.min(320, Math.min(width, height) * 0.8));
              return { width: side, height: side };
            },
            // This overrides the first argument, so include camera selection here.
            ...(constraints === environment ? {} : { videoConstraints: constraints })
          },
          decodedText => {
            if (scanning && !starting) openQrResult(decodedText);
          },
          () => {}
        );
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (isPermissionError(error)) throw error;
      }
    }
    if (lastError) throw lastError;
    scanning = true;
    // Optional enhancements must never turn a successful start into a failure.
    try {
      await configureTrack();
    } catch (error) {
      resetZoom();
      console.info("カメラの追加設定を省略します", error);
    }
    populateCameras(trackSettings(getVideoTrack()).deviceId);
    qrReaderMessage.textContent = "QRコードと周囲の余白を枠内に合わせてください";
  } catch (error) {
    console.error(error);
    qrReaderMessage.textContent = isPermissionError(error)
      ? "カメラの使用を許可してから、もう一度起動してください"
      : "カメラを起動できませんでした。カメラを選び直すか、もう一度起動してください";
    populateCameras("");
  } finally {
    starting = false;
    qrReaderStartButton.disabled = scanning;
    cameraSelect.disabled = false;
  }
}

qrReaderStartButton.addEventListener("click", () => startQrReader());
cameraSelect.addEventListener("change", () => startQrReader(cameraSelect.value));
zoomInput.addEventListener("change", changeZoom);
