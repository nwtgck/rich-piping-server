# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)

## [Unreleased]

## [0.2.2] - 2023-02-18
### Changed
* Update dependencies
* (Docker) Upgrade Docker base image to node:16.17.0-alpine

### Fixed
* Change the way of setting secure context to avoid an error "curl: (35) error:14004410:SSL routines:CONNECT_CR_SRVR_HELLO:sslv3 alert handshake failure" on client side in some environment

## [0.2.1] - 2022-04-09
### Changed
* Update dependencies

## [0.2.0] - 2022-03-30
### Changed
* Update dependencies
* Update internal Piping Server to 1.12.0
* Reject all requests before config loaded 
* Allow --enable-https not only --enable-https=true
* (Docker) Upgrade Docker base image to node:16.14.2-alpine
* Improve HTTPS serving error messages

### Add
* (Docker) Support multi-platform Docker images
* Support multi-platform simple binary distribution
* Upgrade config version to 1
* Add "--config-path" for shorten form of "--config-yaml-path"
* Add --host option to specify bind address
* Support TLS certificate hot reload
* Add "migrate-config" subcommand

[Unreleased]: https://github.com/nwtgck/rich-piping-server/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/nwtgck/rich-piping-server/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/nwtgck/rich-piping-server/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/nwtgck/rich-piping-server/compare/v0.1.2...v0.2.0
