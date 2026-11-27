package org.useclear.capacitor.socket;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Clear's raw socket (Clear Terminal, Phase 6): bytes to a Wi-Fi printer's port 9100, whether one
 * answers there, and printers on this network by DNS-SD ({@code _pdl-datastream._tcp}). The label
 * renderer makes the bytes; this only carries them.
 */
@CapacitorPlugin(name = "ClearSocket")
public class ClearSocketPlugin extends Plugin {

    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void send(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port");
        String data = call.getString("data");
        int timeout = call.getInt("timeoutMs", 8000);
        if (host == null || host.isEmpty() || port == null || data == null) {
            call.reject("A host, a port and the bytes");
            return;
        }
        io.execute(() -> {
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress(host, port), timeout);
                s.setSoTimeout(timeout);
                OutputStream out = s.getOutputStream();
                out.write(Base64.decode(data, Base64.DEFAULT));
                out.flush();
                call.resolve();
            } catch (Exception e) {
                call.reject("Couldn’t reach the printer: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void reachable(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port");
        int timeout = call.getInt("timeoutMs", 3000);
        if (host == null || host.isEmpty() || port == null) {
            call.reject("A host and a port");
            return;
        }
        io.execute(() -> {
            boolean ok;
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress(host, port), timeout);
                ok = true;
            } catch (Exception e) {
                ok = false;
            }
            JSObject r = new JSObject();
            r.put("reachable", ok);
            call.resolve(r);
        });
    }

    /** Browse for a while, then resolve each printer to an address, one at a time (older Androids take one resolve at once). */
    @PluginMethod
    public void discover(PluginCall call) {
        String type = call.getString("type", "_pdl-datastream._tcp");
        int timeout = call.getInt("timeoutMs", 3000);
        NsdManager nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        List<NsdServiceInfo> seen = new ArrayList<>();
        NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override public void onDiscoveryStarted(String t) {}
            @Override public void onDiscoveryStopped(String t) {}
            @Override public void onStartDiscoveryFailed(String t, int code) {}
            @Override public void onStopDiscoveryFailed(String t, int code) {}
            @Override public void onServiceFound(NsdServiceInfo info) { synchronized (seen) { seen.add(info); } }
            @Override public void onServiceLost(NsdServiceInfo info) {}
        };
        nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener);
        main.postDelayed(() -> {
            try {
                nsd.stopServiceDiscovery(listener);
            } catch (IllegalArgumentException ignored) {
                // Discovery never started (no network): nothing to stop.
            }
            List<NsdServiceInfo> queue;
            synchronized (seen) { queue = new ArrayList<>(seen); }
            resolveNext(nsd, queue, new JSArray(), call);
        }, timeout);
    }

    @SuppressWarnings("deprecation")
    private void resolveNext(NsdManager nsd, List<NsdServiceInfo> queue, JSArray printers, PluginCall call) {
        if (queue.isEmpty()) {
            JSObject r = new JSObject();
            r.put("printers", printers);
            call.resolve(r);
            return;
        }
        NsdServiceInfo next = queue.remove(0);
        nsd.resolveService(next, new NsdManager.ResolveListener() {
            @Override
            public void onResolveFailed(NsdServiceInfo info, int code) {
                main.post(() -> resolveNext(nsd, queue, printers, call));
            }

            @Override
            public void onServiceResolved(NsdServiceInfo info) {
                if (info.getHost() != null) {
                    JSObject p = new JSObject();
                    p.put("name", info.getServiceName());
                    p.put("host", info.getHost().getHostAddress());
                    p.put("port", info.getPort());
                    printers.put(p);
                }
                main.post(() -> resolveNext(nsd, queue, printers, call));
            }
        });
    }
}
