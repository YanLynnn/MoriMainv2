// Protected under GNU General Public License v3.0.
// All rights reserved (C) 2026 coflyn.

import Foundation
import UIKit
import AVFoundation
import Capacitor

@_silgen_name("mori_get_engine_key")
func mori_get_engine_key(
    _ challenge: UnsafePointer<CChar>?,
    _ outHex: UnsafeMutablePointer<CChar>?,
    _ maxLen: Int32
) -> Int32

@objc(MoriSecurityPlugin)
public class MoriSecurityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MoriSecurityPlugin"
    public let jsName = "MoriSecurity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getEngineSecurityKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getVideoThumbnail", returnType: CAPPluginReturnPromise)
    ]

    @objc func getEngineSecurityKey(_ call: CAPPluginCall) {
        if Bundle.main.bundleIdentifier != "com.mori.downloader" {
            call.reject("UNAUTHORIZED_CLONE")
            return
        }

        let challenge = call.getString("challenge") ?? ""
        var buf = [CChar](repeating: 0, count: 65)
        let res = challenge.withCString { chalPtr in
            mori_get_engine_key(chalPtr, &buf, 65)
        }

        if res == 0 {
            let hex = String(cString: buf)
            call.resolve(["key": hex])
        } else {
            call.reject("VERIFICATION_FAILED")
        }
    }

    @objc func getVideoThumbnail(_ call: CAPPluginCall) {
        guard var rawPath = call.getString("path"), !rawPath.isEmpty else {
            call.reject("MISSING_PATH")
            return
        }

        if rawPath.contains("/_capacitor_file_/") {
            if let range = rawPath.range(of: "/_capacitor_file_/") {
                rawPath = String(rawPath[range.upperBound...])
                if !rawPath.hasPrefix("/") {
                    rawPath = "/" + rawPath
                }
            }
        }

        if rawPath.hasPrefix("file://") {
            rawPath = String(rawPath.dropFirst(7))
        }

        rawPath = rawPath.removingPercentEncoding ?? rawPath

        var fileUrl = URL(fileURLWithPath: rawPath)
        if !FileManager.default.fileExists(atPath: fileUrl.path) {
            if let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                let trimmed = rawPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                let docPath = docs.appendingPathComponent(trimmed)
                if FileManager.default.fileExists(atPath: docPath.path) {
                    fileUrl = docPath
                }
            }
        }

        guard FileManager.default.fileExists(atPath: fileUrl.path) else {
            call.reject("FILE_NOT_FOUND")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let asset = AVAsset(url: fileUrl)
            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 240, height: 240)

            let time = CMTime(seconds: 1.0, preferredTimescale: 600)
            var cgImage: CGImage?
            do {
                cgImage = try generator.copyCGImage(at: time, actualTime: nil)
            } catch {
                do {
                    cgImage = try generator.copyCGImage(at: .zero, actualTime: nil)
                } catch {}
            }

            guard let finalCg = cgImage else {
                call.reject("EXTRACTION_FAILED")
                return
            }

            let uiImage = UIImage(cgImage: finalCg)
            guard let jpegData = uiImage.jpegData(compressionQuality: 0.6) else {
                call.reject("COMPRESSION_FAILED")
                return
            }

            let b64 = jpegData.base64EncodedString()
            call.resolve(["thumbnail": "data:image/jpeg;base64,\(b64)"])
        }
    }
}
