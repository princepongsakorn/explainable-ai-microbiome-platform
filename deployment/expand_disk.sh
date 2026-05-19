#!/bin/bash
#
# Expand root partition + filesystem to use full disk size.
# Use after resizing the disk in GCP Console (or via gcloud).
# Idempotent — safe to re-run.
#
# Why needed:
#   GCP "Edit instance → boot disk size" only resizes the underlying disk.
#   The partition table + filesystem inside the VM still reference the OLD size.
#   Result: `df -h` shows old size, while GCP Console shows new size.
#
# Usage:
#   sudo ./expand_disk.sh
#
# Optional flags:
#   --check-only    show sizes only, do not modify

set -euo pipefail

CHECK_ONLY=0
if [[ "${1:-}" == "--check-only" ]]; then
  CHECK_ONLY=1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

# ---------- Detect root device + partition ----------
ROOT_SRC="$(findmnt -no SOURCE /)"               # e.g. /dev/sda1
FS_TYPE="$(findmnt -no FSTYPE /)"                # e.g. ext4
PART_NUM="$(echo "${ROOT_SRC}" | grep -oE '[0-9]+$')"
DISK_DEV="$(echo "${ROOT_SRC}" | sed -E 's/[0-9]+$//')"   # e.g. /dev/sda

echo "================================================================"
echo " Disk expansion check"
echo "----------------------------------------------------------------"
echo "  Root mount  : / on ${ROOT_SRC} (${FS_TYPE})"
echo "  Parent disk : ${DISK_DEV}"
echo "  Partition   : ${PART_NUM}"
echo

# ---------- Show current sizes ----------
echo "[CURRENT STATE]"
echo "--- lsblk (kernel-visible disk + partitions) ---"
lsblk "${DISK_DEV}"
echo
echo "--- df -h / (filesystem usage) ---"
df -h /
echo

# ---------- Check if expansion needed ----------
DISK_BYTES="$(blockdev --getsize64 "${DISK_DEV}")"
PART_BYTES="$(blockdev --getsize64 "${ROOT_SRC}")"
DISK_GB="$((DISK_BYTES / 1024 / 1024 / 1024))"
PART_GB="$((PART_BYTES / 1024 / 1024 / 1024))"

echo "  Disk size      : ${DISK_GB} GB (${DISK_BYTES} bytes)"
echo "  Partition size : ${PART_GB} GB (${PART_BYTES} bytes)"
DELTA_GB=$((DISK_GB - PART_GB))
echo "  Unused (Δ)     : ${DELTA_GB} GB"
echo

if [[ "${DELTA_GB}" -lt 1 ]]; then
  echo "Partition already fills disk — nothing to expand."
  exit 0
fi

if [[ "${CHECK_ONLY}" -eq 1 ]]; then
  echo "(--check-only) skipping expansion."
  echo "Run without --check-only to grow partition + filesystem."
  exit 0
fi

# ---------- Install required tools ----------
if ! command -v growpart >/dev/null 2>&1; then
  echo "[INSTALL] cloud-guest-utils (provides growpart)..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq cloud-guest-utils
fi

# ---------- Expand partition ----------
echo "[STEP 1] growpart ${DISK_DEV} ${PART_NUM}"
growpart "${DISK_DEV}" "${PART_NUM}" || {
  rc=$?
  # growpart returns 1 if NOOP (nothing to do)
  if [[ ${rc} -eq 1 ]]; then
    echo "  growpart: NOOP (partition already at max)"
  else
    echo "  growpart failed with code ${rc}" >&2
    exit ${rc}
  fi
}

# ---------- Expand filesystem ----------
echo "[STEP 2] resize filesystem (${FS_TYPE})"
case "${FS_TYPE}" in
  ext2|ext3|ext4)
    resize2fs "${ROOT_SRC}"
    ;;
  xfs)
    xfs_growfs /
    ;;
  btrfs)
    btrfs filesystem resize max /
    ;;
  *)
    echo "  Unknown FS type: ${FS_TYPE}. Resize manually." >&2
    exit 2
    ;;
esac

# ---------- Verify ----------
echo
echo "[AFTER]"
echo "--- lsblk ---"
lsblk "${DISK_DEV}"
echo
echo "--- df -h / ---"
df -h /
echo
echo "================================================================"
echo " Expansion complete."
echo "================================================================"
