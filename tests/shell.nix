{ pkgs ? import <nixpkgs> {}}:
pkgs.mkShell {
  buildInputs = with pkgs; [ pkgconfig python nodejs yarn libusb.dev libusb1];
}
