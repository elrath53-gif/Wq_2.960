package com.estudioeq.app

import android.content.Context
import android.os.Build
import android.view.View
import android.webkit.WebView

class AudioWebView(context: Context) : WebView(context) {

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Crítico: evita que Android baje la prioridad o congele el subproceso
            // de WebAudio al bajar la barra de notificaciones, usar un PDF o cambiar de app.
            setRendererPriorityPolicy(RENDERER_PRIORITY_IMPORTANT, false)
        }
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(View.VISIBLE)
    }

    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        super.onVisibilityChanged(changedView, View.VISIBLE)
    }

    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        // Evita cortes de audio al bajar la cortina de notificaciones, subir volumen
        // o tocar el fondo de pantalla / ventanas superpuestas.
        super.onWindowFocusChanged(true)
    }
}
