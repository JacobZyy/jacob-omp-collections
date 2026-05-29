---
name: update-jacob-omp
description: Update jacob-omp-collections marketplace plugins, skills, and MCP configs. Use when the user wants to update their OMP environment, check for new versions, or sync the latest from the jacob-omp-collections repo.
---

# Update jacob-omp-collections

Manage and update all content from the `JacobZyy/jacob-omp-collections` repository: marketplace plugins, skills, and MCP servers.

## Components

| Component          | Install method         | Update method          |
| ------------------ | ---------------------- | ---------------------- |
| Extensions/Plugins | `/marketplace install` | `/marketplace upgrade` |
| Skills             | `install.sh` symlink   | `install.sh` re-run    |
| MCP Servers        | `install.sh` merge     | `install.sh` re-run    |

## Update Procedures

### 1. Marketplace plugins

```
/marketplace update jacob-omp-collections
/marketplace upgrade aicodegather@jacob-omp-collections
```

Or upgrade all at once:

```
/marketplace upgrade
```

### 2. Skills + MCP

```bash
cd ~/Documents/workspace/jacob-open-source/jacob-omp-collections
git pull
./install.sh
```

### 3. Full update (all components)

```bash
cd ~/Documents/workspace/jacob-open-source/jacob-omp-collections
git pull
./install.sh
```

Then in OMP session:

```
/marketplace update jacob-omp-collections
/marketplace upgrade
```

## Troubleshooting

- **Plugin not updating**: Run `/marketplace update jacob-omp-collections` first to refresh the catalog, then `/marketplace upgrade`
- **Skills not loading**: Verify symlinks exist at `~/.omp/agent/skills/` — re-run `./install.sh`
- **MCP not loading**: Check `~/.omp/agent/mcp.json` has the expected entries — re-run `./install.sh`
- **Fresh install**: `/marketplace add JacobZyy/jacob-omp-collections` then `/marketplace install <name>@jacob-omp-collections` for each plugin, then `./install.sh`
