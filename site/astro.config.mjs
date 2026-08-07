import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const SITE = "https://bitcoinuniverse.github.io";
const BASE = "/index-tandem";

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [
    starlight({
      title: "Tandem",
      description:
        "Tandem is a Bitcoin object two people hold together. One continuous history, cooperative control, planned recovery, and state that two independent indexers have to agree on before anyone reads it.",
      favicon: "/favicon.svg",
      titleDelimiter: "·",
      lastUpdated: false,
      pagination: true,
      credits: false,
      social: [
        {
          icon: "github",
          label: "Indexer repository",
          href: "https://github.com/bitcoinuniverse/index-tandem",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/bitcoinuniverse/index-tandem/edit/main/site/",
      },
      customCss: [
        "@fontsource-variable/inter",
        "@fontsource/instrument-serif/400.css",
        "@fontsource/instrument-serif/400-italic.css",
        "@fontsource-variable/jetbrains-mono",
        "./src/styles/tokens.css",
        "./src/styles/theme.css",
        "./src/styles/prose.css",
        "./src/styles/components.css",
      ],
      components: {
        Head: "./src/overrides/Head.astro",
        SiteTitle: "./src/overrides/SiteTitle.astro",
        PageTitle: "./src/overrides/PageTitle.astro",
        Sidebar: "./src/overrides/Sidebar.astro",
        Footer: "./src/overrides/Footer.astro",
      },
      expressiveCode: {
        themes: ["github-dark-default", "github-light-default"],
        styleOverrides: {
          borderRadius: "0px",
          borderWidth: "1px",
          codeFontFamily: "var(--tdm-font-mono)",
          codeFontSize: "0.8125rem",
          codeLineHeight: "1.7",
          uiFontFamily: "var(--tdm-font-ui)",
          frames: { shadowColor: "transparent" },
        },
      },
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      sidebar: [
        {
          label: "Discover",
          items: [
            { label: "What Tandem is", link: "/discover/what-is-tandem/" },
            { label: "Why Tandem exists", link: "/discover/why-tandem-exists/" },
            { label: "The story of an object", link: "/discover/story-of-an-object/" },
            { label: "What Tandem enables", link: "/discover/what-tandem-enables/" },
            { label: "Where people would use it", link: "/discover/use-cases/" },
            { label: "Why two indexers", link: "/discover/independent-verification/" },
            { label: "Questions", link: "/discover/faq/" },
          ],
        },
        {
          label: "Experience",
          items: [
            { label: "The object journey", link: "/experience/" },
            { label: "Found an object", link: "/experience/create/" },
            { label: "Write a chapter", link: "/experience/chapters/" },
            { label: "Rotate control", link: "/experience/rotate/" },
            { label: "Prepare recovery", link: "/experience/recovery/" },
            { label: "Close together", link: "/experience/close/" },
            { label: "Agreement states", link: "/experience/agreement-states/" },
            { label: "Failure scenarios", link: "/experience/failure-scenarios/" },
          ],
        },
        {
          label: "Build",
          items: [
            { label: "Quickstart", link: "/build/quickstart/" },
            { label: "Integration guide", link: "/build/integration-guide/" },
            { label: "API reference", link: "/build/api-reference/" },
            { label: "The verified surface", link: "/build/verified-api/" },
            { label: "Response shapes", link: "/build/responses/" },
            { label: "Error handling", link: "/build/errors/" },
            { label: "Search and addresses", link: "/build/search-and-addresses/" },
            { label: "Example applications", link: "/build/examples/" },
            { label: "Integration checklist", link: "/build/checklist/" },
          ],
        },
        {
          label: "Operate",
          items: [
            { label: "Architecture", link: "/operate/architecture/" },
            { label: "Deployment", link: "/operate/deployment/" },
            { label: "Configuration", link: "/operate/configuration/" },
            { label: "Bitcoin Core", link: "/operate/bitcoin-core/" },
            { label: "MySQL", link: "/operate/mysql/" },
            { label: "Pipeline B", link: "/operate/pipeline-b/" },
            { label: "Signing", link: "/operate/signing/" },
            { label: "Trust registries", link: "/operate/trust-registries/" },
            { label: "Monitoring", link: "/operate/monitoring/" },
            { label: "Readiness", link: "/operate/readiness/" },
            { label: "Mainnet gates", link: "/operate/mainnet-gates/" },
            { label: "Incident handling", link: "/operate/incidents/" },
            { label: "Troubleshooting", link: "/operate/troubleshooting/" },
          ],
        },
        {
          label: "Understand",
          items: [
            { label: "Protocol concepts", link: "/understand/protocol/" },
            { label: "Object lifecycle", link: "/understand/lifecycle/" },
            { label: "Chapters", link: "/understand/chapters/" },
            { label: "Carriers", link: "/understand/carriers/" },
            { label: "Canonical state", link: "/understand/canonical-state/" },
            { label: "Mempool overlay", link: "/understand/mempool/" },
            { label: "Reorganizations", link: "/understand/reorgs/" },
            { label: "Checkpoints", link: "/understand/checkpoints/" },
            { label: "Agreement tuples", link: "/understand/agreement-tuples/" },
            { label: "Release identity", link: "/understand/release-identity/" },
            { label: "Security boundaries", link: "/understand/security/" },
          ],
        },
        {
          label: "Tools",
          items: [
            { label: "Agreement inspector", link: "/tools/agreement-inspector/" },
            { label: "Response explorer", link: "/tools/response-explorer/" },
            { label: "Lifecycle visualizer", link: "/tools/lifecycle-visualizer/" },
            { label: "Configuration builder", link: "/tools/config-builder/" },
            { label: "Request generator", link: "/tools/request-generator/" },
            { label: "Environment reference", link: "/tools/env-reference/" },
            { label: "Readiness diagnostics", link: "/tools/diagnostics/" },
            { label: "Checklists", link: "/tools/checklists/" },
            { label: "Troubleshooting finder", link: "/tools/troubleshooting-assistant/" },
          ],
        },
        {
          label: "Participate",
          items: [
            { label: "Roadmap", link: "/participate/roadmap/" },
            { label: "Contributing", link: "/participate/contributing/" },
            { label: "Ideas to build", link: "/participate/ideas/" },
            { label: "Early integration", link: "/participate/early-integration/" },
            { label: "Reporting security issues", link: "/participate/security-reporting/" },
            { label: "Repositories", link: "/participate/repositories/" },
            { label: "Protocol artifacts", link: "/participate/artifacts/" },
          ],
        },
      ],
    }),
    mdx(),
    sitemap(),
  ],
});
