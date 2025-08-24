{
  description = "An incredebily opinionated flake and module for chatroom-rs";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/release-25.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            gcc14
            rustc
            cargo
            bun
          ];
        };

        packages.chatroom = pkgs.rustPlatform.buildRustPackage {
          pname = "chatroom";
          version = "0.1.0";
          src = ./.;

          cargoLock = {
            lockFile = ./Cargo.lock;
          };
          cargoBuildOptions = [ "--release" ];
          cargoTestOptions = [ "--release" ];
        };
        packages.default = self.packages.${system}.chatroom;
      }
    )
    // {
      nixosModules.default =
        {
          config,
          pkgs,
          lib,
          ...
        }:
        import ./module.nix {
          inherit config pkgs lib;
          self = self;
          system = pkgs.system;
        };

    };
}
