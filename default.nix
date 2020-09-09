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

  node-gyp-build = ''
    PATH=${pkgs.python2}/bin:$PATH
    if [ -d node_modules/usb/ ]; then
      (cd node_modules/usb/ && node-gyp rebuild --nodedir=${pkgs.lib.getDev pkgs.nodejs}/include/node)
    fi
    if [ -d node_modules/node-hid/ ]; then
      (cd node_modules/node-hid/ && node-gyp rebuild --nodedir=${pkgs.lib.getDev pkgs.nodejs}/include/node)
    fi
  '';

  mkAvalancheProject = { pname, src, workspaceDependencies ? [], buildPhase ? null }:
    pkgs.mkYarnPackage {
      inherit pname workspaceDependencies buildPhase;
      src = gitignoreSource src;
      # Is a workspace, so they all share the same yarn.lock
      yarnLock = ./yarn.lock;
      extraBuildInputs = with pkgs; [ nodePackages.node-gyp pkg-config python libusb1 libudev.dev];
      NIX_CFLAGS_COMPILE = "-I${pkgs.nodejs}/include/node -I${pkgs.lib.getDev pkgs.libusb1}/include/libusb-1.0";
    };

  hw-app-avalanche = mkAvalancheProject {
    pname = "hw-app-avalanche";
    src = ./hw-app-avalanche;
    buildPhase = ''
      yarn run build
      ${node-gyp-build}
    '';
  };

  cli-app-avalanche = mkAvalancheProject {
    pname = "ava-wallet-cli";
    src = ./cli;
    workspaceDependencies = [hw-app-avalanche];
    buildPhase = "${node-gyp-build}";
  };

  gecko = import ./nix/avalanche.nix { inherit pkgs; };
  tests = import ./tests {
    inherit pkgs appElf cli-app-avalanche gecko;
    speculos = (import ./nix/dep/ledger-app-avalanche {}).speculos.speculos;
  };

in {
  inherit cli-app-avalanche hw-app-avalanche gecko;
  tests = tests.test-run;
}
