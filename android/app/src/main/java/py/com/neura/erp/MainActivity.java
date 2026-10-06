package py.com.neura.erp;

import android.app.DownloadManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configurarDescargas();
    }

    /**
     * El WebView por sí solo NO descarga archivos. Acá enganchamos un DownloadListener: cuando la
     * vista intenta bajar algo (por ejemplo una URL firmada con Content-Disposition: attachment,
     * como los adjuntos de Soporte via `url_descarga`), lo derivamos al DownloadManager de Android,
     * que lo guarda en la carpeta "Descargas" y muestra la notificación de progreso del sistema.
     */
    private void configurarDescargas() {
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        this.bridge.getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                req.addRequestHeader("User-Agent", userAgent);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) req.addRequestHeader("cookie", cookies);
                String nombre = URLUtil.guessFileName(url, contentDisposition, mimeType);
                req.setMimeType(mimeType);
                req.setTitle(nombre);
                req.allowScanningByMediaScanner();
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, nombre);
                DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                if (dm != null) {
                    dm.enqueue(req);
                    Toast.makeText(getApplicationContext(), "Descargando " + nombre + "…", Toast.LENGTH_SHORT).show();
                }
            } catch (Exception e) {
                Toast.makeText(getApplicationContext(), "No se pudo descargar el archivo", Toast.LENGTH_SHORT).show();
            }
        });
    }
}
