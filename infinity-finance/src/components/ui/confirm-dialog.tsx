'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Props {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, description, confirmLabel = 'Delete', onConfirm, onCancel }: Props) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogDescription>{description}</DialogDescription>
        <div className="flex gap-2 justify-end mt-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
