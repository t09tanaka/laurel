{
  description = "Laurel static site generator binary package";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      version = "0.1.0";
      supportedSystems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      artifactFor = system:
        if system == "x86_64-linux" then "laurel-linux-x64"
        else if system == "aarch64-linux" then "laurel-linux-arm64"
        else throw "Unsupported system: ${system}";
      sha256For = system:
        if system == "x86_64-linux" then "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        else if system == "aarch64-linux" then "sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
        else throw "Unsupported system: ${system}";
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          artifact = artifactFor system;
        in
        {
          default = pkgs.stdenvNoCC.mkDerivation {
            pname = "laurel";
            inherit version;

            src = pkgs.fetchurl {
              url = "https://github.com/t09tanaka/laurel/releases/download/v${version}/${artifact}";
              sha256 = sha256For system;
            };

            dontUnpack = true;

            installPhase = ''
              install -Dm755 "$src" "$out/bin/laurel"
            '';

            doInstallCheck = true;
            installCheckPhase = ''
              "$out/bin/laurel" --help >/dev/null
            '';

            meta = {
              description = "Ghost-theme-compatible static site generator powered by Markdown and Bun";
              homepage = "https://github.com/t09tanaka/laurel";
              license = pkgs.lib.licenses.mit;
              mainProgram = "laurel";
              platforms = supportedSystems;
            };
          };
        });
    };
}
