{ pkgs ? import ./nix/nixpkgs.nix
, appElf ? (import ./nix/dep/ledger-app-avalanche { runTest = false; debug = true; }).nano.s.app + /bin/app.elf
}:
let
  gitignoreSrc = pkgs.fetchFromGitHub {
    owner = "hercules-ci";
    repo = "gitignore";
    rev = "c4662e662462e7bf3c2a968483478a665d00e717";
    sha256 = "1npnx0h6bd0d7ql93ka7azhj40zgjp815fw2r6smg8ch9p7mzdlx";
  };
  inherit (import gitignoreSrc { inherit (pkgs) lib; }) gitignoreSource;

  # For compatibility with https://github.com/ava-labs/avalanchejs/blob/70413e86dbad0ff122d2e00e403d667d3ba8a22d/package.json#L64
  nodejs = pkgs.nodejs-12_x;

  node-gyp-build = ''
    PATH=${pkgs.python2}/bin:$PATH
    if [ -d node_modules/usb/ ]; then
      (cd node_modules/usb/ && node-gyp rebuild --nodedir=${pkgs.lib.getDev nodejs}/include/node)
    fi
    if [ -d node_modules/node-hid/ ]; then
      (cd node_modules/node-hid/ && node-gyp rebuild --nodedir=${pkgs.lib.getDev nodejs}/include/node)
    fi
  '';

  mkAvalancheWorkspace = { pname, src, workspaceDependencies ? [], buildPhase ? null }:
    pkgs.mkYarnPackage {
      inherit pname workspaceDependencies buildPhase;
      src = gitignoreSource src;
      # Is a workspace, so they all share the same yarn.lock
      yarnLock = ./yarn.lock;
      extraBuildInputs = with pkgs; [ nodePackages.node-gyp pkg-config python libusb1 libudev.dev];
      NIX_CFLAGS_COMPILE = "-I${nodejs}/include/node -I${pkgs.lib.getDev pkgs.libusb1}/include/libusb-1.0";
    };

  cli-app-avalanche = mkAvalancheWorkspace {
    pname = "ava-wallet-cli";
    src = ./cli;
    buildPhase = "${node-gyp-build}";
  };

  makeSnap = pkgs.callPackage ./nix/make-snap.nix {};
  snapPackage = makeSnap {
    meta = {
      name = "avalanche-cli";
      apps = {
        "avalanche-cli" = {
          command = "usr/" + (pkgs.lib.removePrefix "/nix/" "${cli-app-avalanche}/bin/avalanche-ledger-cli");
          plugs = [ "network" ];
        };
      };
      plugs = {
        hidraw = {
          "usb-vendor" = "2c97";
          "usb-product" = "0001"; # Probably need to add nano X here if this plug starts being used.
          "path" = "/dev/hidraw0";
        };
      };
    };
  };

  avash = import ./nix/avash.nix { inherit pkgs; };
  gecko = import ./nix/avalanche.nix { inherit pkgs; };
  tests = import ./tests {
    inherit pkgs appElf cli-app-avalanche gecko;
    speculos = (import ./nix/dep/ledger-app-avalanche {}).speculos.speculos;
  };

  shell = pkgs.mkShell {
    buildInputs = [ avash gecko nodejs ] ++ (with pkgs; [ bats pkgconfig python libusb1 libudev.dev yarn ]);
  };

in {
  inherit cli-app-avalanche gecko shell snapPackage;
  tests-full = tests;
  tests = tests.test-run;
}
