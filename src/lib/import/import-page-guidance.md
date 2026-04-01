# 导入页需要改的两处

## 1. 上传区只保留一组文件选择入口
- 单文件、多文件、文件夹上传统一到一组控件
- 不要同时渲染两个“选择文件”按钮

## 2. 原文对照默认只显示当前题
- 不再展示“当前题附近片段”列表
- 改为直接读取 `buildCurrentQuestionSlice(...)`
- 如需上下文，额外加“展开上下文”按钮

## 参考接法
```ts
const currentSourceSlice = useMemo(() => {
  if (!currentQuestionNo || !parsedQuestions.length) return null
  return buildCurrentQuestionSlice(parsedQuestions, currentQuestionNo)
}, [currentQuestionNo, parsedQuestions])
```

```tsx
{currentSourceSlice ? (
  <pre className="whitespace-pre-wrap rounded-xl border p-3 text-sm leading-7">
    {currentSourceSlice}
  </pre>
) : (
  <div className="text-sm text-muted-foreground">当前题暂无原文对照</div>
)}
```
