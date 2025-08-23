{
  config,
  pkgs,
  lib,
  ...
}:
with lib;
let
  cfg = config.services.chatroom-rs;
in
{
  options.services.chatroom-rs = {
    enable = mkEnableOption "Enable chatroom-rs with all of it's dependencies";
    url = {
      type = types.str;
      description = "Url for the reverse proxy";
    };
    # duckdnsTokenFile = mkOption {
    #   type = types.path;
    #   description = "Path to the file containing your duckdns token";
    # };
    duckdnsToken = mkOption {
      type = types.str;
      description = "Your duckdns token";
    };
    dataLocation = mkOption {
      type = types.path;
      description = "Path to save all permananent data such as the database";
    };
    openFirewall = mkOption {
      type = types.bool;
      default = true;
      description = "Opens the 80 and 443 ports of the firewall";
    };
    hostAddress = mkOption {
      type = types.str;
      description = "The nixos containers host address";
    };
  };

  config = {
    containers.chatroom-rs = {
      autoStart = true;
      hostAddress = cfg.hostAddress;
      localAddress = "10.0.0.1";
      privateNetwork = true;

      forwardPorts = [
        {
          containerPort = 80;
          hostPort = 80;
          protocol = "tcp";
        }
        {
          containerPort = 443;
          hostPort = 443;
          protocol = "tcp";
        }
      ];

      ephemeral = true;

      bindMounts = {
        "/var/lib/mysql" = {
          hostPath = "${cfg.dataLocation}/mysql";
          isReadOnly = false;
        };
        "/crowdsec" = {
          hostPath = "${cfg.dataLocation}/crowdsec";
          isReadOnly = false;
        };
      };

      config =
        { config, pkgs, ... }:
        {
          system.stateVersion = "25.05";

          systemd.services.chatroom = {
            description = "Chatroom-rs Service";
            after = [ "network.target" ];
            path = with pkgs; [
              cargo
              rustc
              gcc14
            ];

            serviceConfig = {
              Type = "simple";
              WorkingDirectory = "/var/www/chatroom-rs";
              ExecStart = "$${self.packages.${pkgs.system}.server}/bin/server";
              Restart = "no";
              Environment = "RUST_LOG=debug";
            };
          };
          services.caddy = {
            enable = true;
            package = pkgs.caddy.withPlugins {
              plugins = [
                "github.com/caddy-dns/duckdns@v0.5.0"
                "dev.mediocregopher.com/mediocre-caddy-plugins.git@v0.0.0-20250308151243-7a689b14191a"
                "github.com/hslatman/caddy-crowdsec-bouncer@v0.9.2"
              ];
              hash = "sha256-gzq5RonV2VeR/U3oUZHm1piRjzh2F92wc5tvHPFH+2I=";
            };

            virtualHosts = {
              "${cfg.url}" = {
                extraConfig = ''
                  root * /var/www/chatroom
                  file_server

                  handle_path /ws* {
                    reverse_proxy localhost:8080 {
                    }
                  }

                  # tls internal # Use incase of emergency

                  proof_of_work / {
                      challenge_timeout 24h
                  }

                  crowdsec {
                    api_url http://localhost:5678
                    api_key Q72ouwXU0hPs3Cw8hKi5q0GJBC1RQ1saGUsjR5ifCKVRGnFcSQPErXGwyxu9WePf
                    ticker_interval 15s
                    appsec_url http://localhost:6789
                    #disable_streaming
                    #enable_hard_fails
                  }

                  tls {
                    dns duckdns {env.DUCKDNS_TOKEN}
                  }
                '';
              };
            };

          };
          systemd.services.caddy.serviceConfig.Environment = [
            "DUCKDNS_TOKEN=${cfg.duckdnsToken}"
          ];
          networking.firewall.allowedTCPPorts = [
            80
            443
          ];

          virtualisation = {
            oci-containers = {
              backend = "podman";
            };
            containers.enable = true;
            containers.containersConf.cniPlugins = [
              pkgs.cni-plugins
              pkgs.dnsname-cni
            ];
            containers.storage.settings = {
              storage = {
                driver = "overlay";
                runroot = "/run/containers/storage";
                graphroot = "/var/lib/containers/storage";
                rootless_storage_path = "/tmp/containers-$USER";
                options.overlay.mountopt = "nodev,metacopy=on";
              };
            };
          };
          virtualisation.podman = {
            enable = true;
            dockerCompat = true;
            extraPackages = with pkgs; [
              zfs
              iputils
            ];
            defaultNetwork.settings = {
              dns_enabled = true;
            };
          };

          environment.systemPackages = (with pkgs; [ slirp4netns ]);
          environment.extraInit = ''
            if [ -z "$DOCKER_HOST" -a -n "$XDG_RUNTIME_DIR" ]; then
            	export DOCKER_HOST="unix://$XDG_RUNTIME_DIR/podman/podman.sock"
            fi
          '';
          virtualisation.oci-containers = {
            containers.crowdsec = {
              hostname = "crowdsec";
              image = "crowdsecurity/crowdsec:v1.6.11";
              volumes = [
                "/crowdsec:/var/lib/crowdsec/data"
                "/crowdsec:/etc/crowdsec"
              ];
              ports = [
                "5678:8080"
                "6789:6060"
              ];
              environment = {
                "COLLECTIONS" = "crowdsecurity/apache2 crowdsecurity/sshd";
              };
              extraOptions = [
              ];
            };
          };
          systemd.tmpfiles.rules = [
            "d /crowdsec 0770 caddy caddy - -"
            "d /crowdsec/data 0770 caddy caddy - -"
            "d /crowdsec/config 0770 caddy caddy - -"
          ];
        };
    };
    systemd.tmpfiles.rules = [
      "d ${cfg.dataLocation}/mysql 0770 mysql mysql - -"
      "d ${cfg.dataLocation}/crowdsec 0770 caddy caddy - -"
    ];
  };
}
