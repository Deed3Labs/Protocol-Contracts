import Foundation
import Capacitor
import Network

/// Clear's raw socket (Clear Terminal, Phase 6): bytes to a Wi-Fi printer's port 9100, whether one
/// answers there, and printers on this network by Bonjour (`_pdl-datastream._tcp`). The label
/// renderer makes the bytes; this only carries them.
@objc(ClearSocketPlugin)
public class ClearSocketPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClearSocketPlugin"
    public let jsName = "ClearSocket"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reachable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discover", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "org.useclear.socket")

    /// Calls `body` once, however many of ready, failed and the timeout fire.
    private final class Once {
        private var done = false
        private let lock = NSLock()
        func run(_ body: () -> Void) {
            lock.lock()
            let first = !done
            done = true
            lock.unlock()
            if first { body() }
        }
    }

    private func endpoint(_ call: CAPPluginCall) -> (NWEndpoint.Host, NWEndpoint.Port)? {
        guard let host = call.getString("host"), !host.isEmpty,
              let raw = call.getInt("port"), let port = NWEndpoint.Port(rawValue: UInt16(clamping: raw)) else { return nil }
        return (NWEndpoint.Host(host), port)
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let target = endpoint(call), let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("A host, a port and the bytes")
            return
        }
        let (host, port) = target
        let timeout = Double(call.getInt("timeoutMs") ?? 8000) / 1000
        let conn = NWConnection(host: host, port: port, using: .tcp)
        let once = Once()
        let fail: (String) -> Void = { message in once.run { conn.cancel(); call.reject(message) } }
        conn.stateUpdateHandler = { state in
            switch state {
            case .ready:
                conn.send(content: data, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { error in
                    if let error = error {
                        fail("The printer stopped taking it: \(error.localizedDescription)")
                    } else {
                        once.run { conn.cancel(); call.resolve() }
                    }
                })
            case .failed(let error), .waiting(let error):
                fail("Couldn’t reach the printer: \(error.localizedDescription)")
            default:
                break
            }
        }
        conn.start(queue: queue)
        queue.asyncAfter(deadline: .now() + timeout) { fail("The printer didn’t answer") }
    }

    @objc func reachable(_ call: CAPPluginCall) {
        guard let target = endpoint(call) else {
            call.reject("A host and a port")
            return
        }
        let (host, port) = target
        let timeout = Double(call.getInt("timeoutMs") ?? 3000) / 1000
        let conn = NWConnection(host: host, port: port, using: .tcp)
        let once = Once()
        let answer: (Bool) -> Void = { ok in once.run { conn.cancel(); call.resolve(["reachable": ok]) } }
        conn.stateUpdateHandler = { state in
            switch state {
            case .ready: answer(true)
            case .failed, .waiting: answer(false)
            default: break
            }
        }
        conn.start(queue: queue)
        queue.asyncAfter(deadline: .now() + timeout) { answer(false) }
    }

    /// Browse for a while, then resolve each printer to an address by connecting to it.
    @objc func discover(_ call: CAPPluginCall) {
        let type = call.getString("type") ?? "_pdl-datastream._tcp"
        let timeout = Double(call.getInt("timeoutMs") ?? 3000) / 1000
        let browser = NWBrowser(for: .bonjour(type: type, domain: nil), using: .tcp)
        var found: [NWEndpoint] = []
        browser.browseResultsChangedHandler = { results, _ in
            found = results.map { $0.endpoint }
        }
        browser.start(queue: queue)
        queue.asyncAfter(deadline: .now() + timeout) {
            browser.cancel()
            let group = DispatchGroup()
            var printers: [[String: Any]] = []
            let lock = NSLock()
            for ep in found {
                guard case let .service(name, _, _, _) = ep else { continue }
                group.enter()
                let conn = NWConnection(to: ep, using: .tcp)
                let once = Once()
                let finish: ([String: Any]?) -> Void = { row in
                    once.run {
                        conn.cancel()
                        if let row = row { lock.lock(); printers.append(row); lock.unlock() }
                        group.leave()
                    }
                }
                conn.stateUpdateHandler = { state in
                    switch state {
                    case .ready:
                        if case let .hostPort(host, port) = conn.currentPath?.remoteEndpoint {
                            var address: String
                            switch host {
                            case .ipv4(let a): address = "\(a)"
                            case .ipv6(let a): address = "[\(a)]"
                            case .name(let n, _): address = n
                            @unknown default: address = "\(host)"
                            }
                            if let pct = address.firstIndex(of: "%") { address = String(address[..<pct]) }
                            finish(["name": name, "host": address, "port": Int(port.rawValue)])
                        } else {
                            finish(nil)
                        }
                    case .failed, .waiting: finish(nil)
                    default: break
                    }
                }
                conn.start(queue: self.queue)
                self.queue.asyncAfter(deadline: .now() + 3) { finish(nil) }
            }
            group.notify(queue: self.queue) { call.resolve(["printers": printers]) }
        }
    }
}
