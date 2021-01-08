{ pkgs ? import ./nix/nixpkgs.nix }: pkgs.mkShell {
  buildInputs = [ pkgs.bats pkgs.pkgconfig pkgs.python pkgs.libusb1 pkgs.libudev.dev pkgs.nodejs pkgs.yarn ];
}
