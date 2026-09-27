Pod::Spec.new do |s|
  s.name             = 'MoriSecurity'
  s.version          = '1.0.0'
  s.summary          = 'Native security layer for Mori iOS'
  s.description      = 'Precompiled native binary verification for Mori'
  s.homepage         = 'https://mori.downloader'
  s.license          = { :type => 'GPL-3.0' }
  s.author           = { 'coflyn' => 'coflyn@github.com' }
  s.source           = { :git => '' }
  s.platform         = :ios, '14.0'
  s.source_files     = 'ios/Sources/**/*.{swift,h,m}'
  s.frameworks       = 'AVFoundation', 'UIKit'
  s.dependency 'Capacitor'
  s.vendored_frameworks = 'ios/morisec.xcframework'
  s.swift_version    = '5.1'
end
