# patches/

dsh 宿主仓库（`~/projects/lab/deepseek-harness`）是 deepseek 官方上游的只读镜像：
唯一远程为 `upstream`，不做本地提交、不建 fork、不推送。
本目录保存历史上对 dsh 做过的本地补丁，仅作记录与备查。

## intranet-hostname.patch

- **来源**：dsh 本地提交 `97cf30b3fb`（2026-09-23，基于 v0.1.7-alpha.2 时代代码）。
- **作用**：client settings plane 把内网域名 `dsh.mosipdev.xiongdi.asia` 视为 loopback，
  使经 nginx22 反代的雄帝 dev 内网部署保持 host mode（服务端已有特权方法门禁兜底）。
- **适用性**：对当前 upstream master（0.2.x）**不能直接 `git apply`**（`packages/client/connection/src/client/index.ts`
  附近代码已重构），需要时按新代码手工改写。
- **使用原则**：官方仓库只读。确需此行为时把改写后的补丁 `git apply` 到 dsh 工作树使用
  （不提交、不进版本库），并考虑向上游提 PR 使其成为正式能力。
