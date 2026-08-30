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


/* =========================================
   QR内容確認
========================================= */

function openQrResult(
  decodedText
) {

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

async function startQrReader() {

  if (scanning) {
    return;
  }


  if (
    typeof Html5Qrcode ===
    "undefined"
  ) {

    qrReaderMessage.textContent =
      "QR読取機能を読み込めませんでした";

    return;
  }


  qrReaderStartButton.disabled =
    true;


  qrReaderMessage.textContent =
    "カメラを起動しています…";


  try {

    qrScanner =
      new Html5Qrcode(
        "qrReader"
      );


    await qrScanner.start(

      {
        facingMode:
          "environment"
      },

      {
        fps:
          10,

        qrbox: {
          width:
            250,

          height:
            250
        }
      },

      decodedText => {

        openQrResult(
          decodedText
        );
      },

      () => {

        /*
          読取途中のエラーは
          何も表示しない
        */

      }
    );


    scanning =
      true;


    qrReaderMessage.textContent =
      "QRコードを枠内に合わせてください";


  } catch (error) {

    console.error(
      error
    );


    qrReaderMessage.textContent =
      "カメラを起動できませんでした";


    qrReaderStartButton.disabled =
      false;
  }
}


/* =========================================
   イベント
========================================= */

qrReaderStartButton.addEventListener(
  "click",
  startQrReader
);