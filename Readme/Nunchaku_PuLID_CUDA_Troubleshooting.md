# Nunchaku PuLID CUDA Troubleshooting

Use this guide when Nunchaku PuLID fails with
`CUDNN_STATUS_SUBLIBRARY_VERSION_MISMATCH`, when ONNX Runtime reports multiple
packages in the same location, or when ordinary PyTorch CUDA convolutions fail
after a dependency update.

## What the error means

`CUDNN_STATUS_SUBLIBRARY_VERSION_MISMATCH` points to incompatible cuDNN components
loaded into the process. An update may have left mixed binary files or library
search paths pointing to another installation. Downgrading cuDNN without checking
PyTorch's requirements can create another mismatch.

`onnxruntime` and `onnxruntime-gpu` are separate Python distributions that install
the same `onnxruntime` module. Keep only one distribution in the environment.
Some InsightFace installations can bring in the CPU distribution alongside an
existing GPU installation.

This pack leaves ONNX Runtime out of its main `requirements.txt`; choose the
runtime for the optional PuLID setup separately. The GPU build must match
PyTorch's CUDA and cuDNN requirements, including minimum runtime versions.
cuDNN major versions are not interchangeable. Check the
[official CUDA compatibility matrix](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html#requirements)
for the release you intend to install; a current unpinned GPU wheel is not a
universal match for an existing ComfyUI environment.

## Before repairing the environment

Stop ComfyUI completely. Identify the Python executable used by ComfyUI from its
startup log, then save the current package state. These commands use a Linux
shell; replace the example Python path with the one from your installation.

```bash
COMFY_PYTHON=/path/to/ComfyUI/venv/bin/python
"$COMFY_PYTHON" -m pip freeze --all > comfy-env-before-onnx-repair.txt
"$COMFY_PYTHON" -m pip show onnxruntime onnxruntime-gpu torch nunchaku
```

Inspect installed NVIDIA packages and the exact dependencies declared by
PyTorch. This reads package metadata without loading CUDA libraries:

```bash
"$COMFY_PYTHON" - <<'PY'
from importlib.metadata import distributions, requires

packages = sorted(
    (dist.metadata.get("Name", ""), dist.version)
    for dist in distributions()
    if dist.metadata.get("Name", "").lower().startswith("nvidia-")
)
for name, version in packages:
    print(name, version)

for requirement in requires("torch") or ():
    if "nvidia-" in requirement.lower():
        print("torch requires:", requirement)
PY
```

## Repair the conflicting installation

Choose and download a wheel for your platform, Python version and CUDA/cuDNN
stack using the [official installation instructions](https://onnxruntime.ai/docs/install/).
Have that wheel available before removing a conflicting installation. For a GPU
setup with both ONNX distributions installed, remove both and reinstall only the
chosen GPU wheel so uninstalling the CPU package cannot leave shared files missing:

```bash
ONNX_WHEEL=/absolute/path/to/the/compatible/onnxruntime_gpu.whl
"$COMFY_PYTHON" -m pip uninstall -y onnxruntime onnxruntime-gpu
"$COMFY_PYTHON" -m pip install --no-cache-dir --no-deps "$ONNX_WHEEL"
"$COMFY_PYTHON" -m pip check
```

Replace `ONNX_WHEEL` with the actual downloaded wheel filename. `--no-deps` keeps
this reinstall focused on ONNX Runtime; resolve any missing runtime dependencies
reported by `pip check` against the chosen wheel's requirements.

If the cuDNN/cuBLAS installation itself is damaged, reinstall the versions
required by your existing PyTorch build using the same package source as that
environment. Check its applicable platform markers and library search paths.
Do not remove working NVIDIA packages just to repair duplicate ONNX modules.

InsightFace may make `pip check` report that the distribution named
`onnxruntime` is absent. Do not reinstall the CPU wheel merely to silence that
metadata warning: doing so recreates the duplicate module installation. Confirm
runtime behavior instead.

## Verify before restarting ComfyUI

For the CUDA provider, this check should report the intended PyTorch/CUDA/cuDNN
versions, list `CUDAExecutionProvider`, and complete a CUDA convolution. Import
PyTorch before creating ONNX sessions so its libraries can be reused, as described
in [ONNX Runtime's PyTorch guidance](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html#compatibility-with-pytorch).

```bash
"$COMFY_PYTHON" - <<'PY'
import torch
import onnxruntime as ort

print("torch:", torch.__version__)
print("CUDA:", torch.version.cuda)
print("cuDNN:", torch.backends.cudnn.version())
print("ONNX Runtime:", ort.__version__)
print("providers:", ort.get_available_providers())

image = torch.randn(1, 3, 64, 64, device="cuda")
convolution = torch.nn.Conv2d(3, 8, 3).cuda()
print("convolution:", tuple(convolution(image).shape))
torch.cuda.synchronize()
PY
```

The provider list alone does not prove that an ONNX CUDA session works. Restart
ComfyUI, queue the PuLID workflow with **CUDA** selected, and check the ONNX session
logs as well as the completed result. This exercises the actual face-analysis
models and catches provider initialization failures or CPU fallback.

## Using CPU face analysis

With **CPU** selected for `insight_face_provider`, the face-analysis ONNX models
run on the CPU while the PuLID and Flux torch modules can still use CUDA. This
path also bypasses cuDNN during face-embedding extraction and restores the prior
PyTorch backend state afterward. The log line `provider=CPU, face cuDNN disabled`
confirms that path. It does not repair a PyTorch CUDA installation that also fails
outside face analysis.
