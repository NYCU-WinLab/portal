"use client"

import { PencilIcon, Trash2Icon } from "lucide-react"
import * as React from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { report } from "@/lib/report"

import { createPost, deletePost, updatePost } from "./actions"

type Post = { id: string; title: string; content: string }

const text = (data: FormData, key: string) => String(data.get(key) ?? "")

function PostForm({
  post,
  trigger,
}: {
  post?: Post
  trigger: React.ReactElement
}) {
  const [notify, setNotify] = React.useState(true)

  async function submit(data: FormData) {
    const fields = {
      title: text(data, "title"),
      content: text(data, "content"),
    }
    await report(
      post
        ? updatePost({ id: post.id, ...fields })
        : createPost({ ...fields, notify }),
      post ? "已儲存" : notify ? "已發布並寄信" : "已發布"
    )
  }

  return (
    <FormDialog
      trigger={trigger}
      onOpenChange={(open) => open && setNotify(true)}
      size="wide"
      title={post ? "編輯公告" : "發公告"}
      submitLabel={post ? "儲存" : "發布"}
      onSubmit={submit}
    >
      <FormField label="標題" required>
        <Input name="title" maxLength={100} defaultValue={post?.title} />
      </FormField>
      <FormField label="內容" required>
        <Textarea
          name="content"
          rows={8}
          maxLength={5000}
          defaultValue={post?.content}
        />
      </FormField>
      {!post && (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="post-notify">寄信給全實驗室</Label>
          <Switch
            id="post-notify"
            checked={notify}
            onCheckedChange={setNotify}
          />
        </div>
      )}
    </FormDialog>
  )
}

export function NewPost() {
  return <PostForm trigger={<Button>發公告</Button>} />
}

export function PostActions({ post }: { post: Post }) {
  return (
    <>
      <PostForm
        post={post}
        trigger={
          <Button variant="ghost" size="icon" aria-label="編輯">
            <PencilIcon />
          </Button>
        }
      />
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="icon" aria-label="刪除">
            <Trash2Icon />
          </Button>
        }
        title={`刪除「${post.title}」？`}
        confirmLabel="刪除"
        onConfirm={() => report(deletePost(post.id), "已刪除")}
      />
    </>
  )
}
