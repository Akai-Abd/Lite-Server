import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useDropzone } from 'react-dropzone'

// Helper: Format bytes to human readable format
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Helper: Get icon based on file type or extension
function getFileIcon(name: string, isDirectory: boolean): string {
  if (isDirectory) return '📁'
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return '🖼️'
  if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return '🎵'
  if (['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) return '🎬'
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return '📦'
  if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) return '📄'
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'py', 'go', 'rs', 'css', 'html'].includes(ext)) return '💻'
  return '📃'
}

interface User {
  id: string
  username: string
  email: string
  role: 'admin' | 'user' | 'guest'
  status?: string
}

function App() {
  // Navigation & View Mode State
  const [activeView, setActiveView] = useState<'files' | 'admin'>('files')

  // File Explorer State
  const [files, setFiles] = useState<any[]>([])
  const [currentPath, setCurrentPath] = useState('/uploads')
  const [uploadMode, setUploadMode] = useState<'file' | 'folder'>('file')
  const [isUploadingFolder, setIsUploadingFolder] = useState(false)
  const [folderUploadStatus, setFolderUploadStatus] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Auth & User State
  const [token, setToken] = useState(() => localStorage.getItem('ar-web-token') || '')
  const [user, setUser] = useState<User | null>(() => {
    const savedUser = localStorage.getItem('ar-web-user')
    return savedUser ? JSON.parse(savedUser) : null
  })
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem('ar-web-token'))

  // Admin Panel User Management State
  const [users, setUsers] = useState<User[]>([])
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  const [isCreatingUser, setIsCreatingUser] = useState(false)
  const [userFormData, setUserFormData] = useState({
    username: '',
    email: '',
    password: '',
    role: 'user',
  })

  // View Modes & Categories
  type Category = 'All' | 'Images' | 'Videos' | 'Archive' | 'Folders' | 'Documents'
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [activeCategory, setActiveCategory] = useState<Category>('All')
  const [pathCategories, setPathCategories] = useState<Record<string, Category>>({'/uploads': 'All'})

  // File Preview State
  const [previewFile, setPreviewFile] = useState<{ path: string, name: string, type: 'image' | 'video' | 'document' } | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')

  // Toast Notifications State
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'error' | 'info' }>>([])
  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev.slice(-4), { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }

  // Search, Folder Creation, Rename & Clipboard State
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renameTarget, setRenameTarget] = useState<{ path: string; name: string } | null>(null)
  const [renameNewName, setRenameNewName] = useState('')
  const [clipboard, setClipboard] = useState<{ mode: 'cut' | 'copy'; paths: string[] } | null>(null)

  // Phase 2, 3, 4: Upload Progress, Trash, Audit, Share & Group States
  const [uploadProgress, setUploadProgress] = useState<{ active: boolean; percent: number; filename: string } | null>(null)
  const [trashItems, setTrashItems] = useState<any[]>([])
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [shares, setShares] = useState<any[]>([])
  const [groups, setGroups] = useState<any[]>([])
  const [adminTab, setAdminTab] = useState<'users' | 'groups' | 'shares' | 'audit'>('users')

  // Theme State
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('ar-theme') as 'light' | 'dark') || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('ar-theme', theme)
  }, [theme])

  // Text Editor State
  const [editFileTarget, setEditFileTarget] = useState<{ path: string; name: string; content: string } | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  // Group Modal State
  const [showAddGroupModal, setShowAddGroupModal] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDesc, setNewGroupDesc] = useState('')

  // Share Link Modal State
  const [shareModalTarget, setShareModalTarget] = useState<{ path: string; name: string } | null>(null)
  const [sharePassword, setSharePassword] = useState('')
  const [shareExpiresAt, setShareExpiresAt] = useState('')
  const [shareMaxDownloads, setShareMaxDownloads] = useState('')
  const [createdShareUrl, setCreatedShareUrl] = useState('')


  useEffect(() => {
    if (!previewFile) {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl('')
      return
    }
    fetch(`/api/files/download?path=${encodeURIComponent(previewFile.path)}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    .then(r => r.blob())
    .then(blob => setPreviewUrl(URL.createObjectURL(blob)))
  }, [previewFile, token])

  const handleCategoryChange = (cat: Category) => {
    setActiveCategory(cat)
    setPathCategories(prev => ({ ...prev, [currentPath]: cat }))
  }

  const handleNavigate = (path: string) => {
    setCurrentPath(path)
    setActiveCategory(pathCategories[path] || 'All')
  }

  const isTextFile = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    return ['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'py', 'yml', 'yaml', 'xml', 'sh', 'env', 'csv', 'log'].includes(ext)
  }

  const handleOpenEditor = async (file: any) => {
    try {
      const res = await fetch(`/api/files/content?path=${encodeURIComponent(file.virtualPath)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const result = await res.json()
      if (result.success) {
        setEditFileTarget({ path: file.virtualPath, name: file.name, content: result.data.content })
      } else {
        addToast(result.error?.message || 'Failed to read file content', 'error')
      }
    } catch {
      addToast('Error reading file for editing', 'error')
    }
  }

  const handleSaveEditor = async () => {
    if (!editFileTarget) return
    setIsSavingEdit(true)
    try {
      const res = await fetch('/api/files/content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ path: editFileTarget.path, content: editFileTarget.content })
      })
      const result = await res.json()
      if (result.success) {
        addToast(`Saved "${editFileTarget.name}"`, 'success')
        setEditFileTarget(null)
        loadFiles(currentPath)
      } else {
        addToast(result.error?.message || 'Failed to save file', 'error')
      }
    } catch {
      addToast('Error saving file', 'error')
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handlePreview = (file: any) => {
    if (file.type === 'directory') return;
    if (isTextFile(file.name)) {
      handleOpenEditor(file)
      return
    }
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    let type: 'image' | 'video' | 'document' | null = null
    
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico'].includes(ext)) type = 'image'
    else if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext)) type = 'video'
    else if (['pdf'].includes(ext)) type = 'document'
    
    if (type) {
      setPreviewFile({ path: file.virtualPath, name: file.name, type })
    } else {
      handleDownload(file.virtualPath, file.name)
    }
  }

  const filteredFiles = useMemo(() => {
    return files.filter(file => {
      if (searchQuery.trim() && !file.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (activeCategory === 'All') return true;
      if (activeCategory === 'Folders') return file.type === 'directory';
      
      if (file.type === 'directory') return false;
      
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (activeCategory === 'Images') return ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico'].includes(ext);
      if (activeCategory === 'Videos') return ['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext);
      if (activeCategory === 'Archive') return ['zip', 'tar', 'gz', '7z', 'rar'].includes(ext);
      if (activeCategory === 'Documents') return ['pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'xls', 'xlsx'].includes(ext);
      
      return false;
    });
  }, [files, activeCategory, searchQuery]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFolderName.trim()) return
    try {
      const response = await fetch('/api/files/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ path: `${currentPath}/${newFolderName.trim()}` })
      })
      const result = await response.json()
      if (result.success) {
        addToast(`Folder "${newFolderName}" created`, 'success')
        setShowNewFolderModal(false)
        setNewFolderName('')
        loadFiles(currentPath)
      } else {
        addToast(result.error?.message || 'Failed to create folder', 'error')
      }
    } catch {
      addToast('Error creating folder', 'error')
    }
  }

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!renameTarget || !renameNewName.trim()) return
    const parts = renameTarget.path.split('/')
    parts.pop()
    const newPath = `${parts.join('/')}/${renameNewName.trim()}`
    try {
      const response = await fetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ oldPath: renameTarget.path, newPath })
      })
      const result = await response.json()
      if (result.success) {
        addToast('Renamed successfully', 'success')
        setRenameTarget(null)
        setRenameNewName('')
        loadFiles(currentPath)
      } else {
        addToast(result.error?.message || 'Failed to rename', 'error')
      }
    } catch {
      addToast('Error renaming item', 'error')
    }
  }

  const handlePaste = async () => {
    if (!clipboard || clipboard.paths.length === 0) return
    const endpoint = clipboard.mode === 'cut' ? '/api/files/move' : '/api/files/copy'
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sources: clipboard.paths, destination: currentPath })
      })
      const result = await response.json()
      if (result.success) {
        addToast(`${clipboard.mode === 'cut' ? 'Moved' : 'Copied'} ${clipboard.paths.length} item(s)`, 'success')
        if (clipboard.mode === 'cut') setClipboard(null)
        loadFiles(currentPath)
      } else {
        addToast(result.error?.message || 'Paste operation failed', 'error')
      }
    } catch {
      addToast('Error during paste operation', 'error')
    }
  }

  // Load files from server for target path
  const loadFiles = async (path: string = currentPath, authToken: string = token) => {
    if (!authToken) return
    try {
      const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (response.ok) {
        setIsAuthenticated(true)
        const result = await response.json()
        if (result.success) {
          setFiles(result.data)
        }
      } else if (response.status === 401) {
        handleLogout()
      }
    } catch (error) {
      console.error('Load files error:', error)
    }
  }

  // Load user list for admin console
  const loadUsers = async (authToken: string = token) => {
    if (!authToken) return
    try {
      const response = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const result = await response.json()
      if (result.success) {
        setUsers(result.data.items || [])
      }
    } catch (error) {
      console.error('Load users error:', error)
    }
  }

  // Load trash items
  const loadTrash = async (authToken: string = token) => {
    if (!authToken) return
    try {
      const response = await fetch('/api/trash', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const result = await response.json()
      if (result.success) setTrashItems(result.data || [])
    } catch (error) {
      console.error('Load trash error:', error)
    }
  }

  // Load audit logs
  const loadAuditLogs = async (authToken: string = token) => {
    if (!authToken) return
    try {
      const response = await fetch('/api/audit', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const result = await response.json()
      if (result.success) setAuditLogs(result.data || [])
    } catch (error) {
      console.error('Load audit logs error:', error)
    }
  }

  // Load shares
  const loadShares = async (authToken: string = token) => {
    if (!authToken) return
    try {
      const response = await fetch('/api/shares', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const result = await response.json()
      if (result.success) setShares(result.data || [])
    } catch (error) {
      console.error('Load shares error:', error)
    }
  }

  // Load groups
  const loadGroups = async (authToken: string = token) => {
    if (!authToken) return
    try {
      const response = await fetch('/api/groups', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const result = await response.json()
      if (result.success) setGroups(result.data || [])
    } catch (error) {
      console.error('Load groups error:', error)
    }
  }

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName.trim()) return
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newGroupName.trim(), description: newGroupDesc.trim() || undefined })
      })
      const result = await res.json()
      if (result.success) {
        addToast(`Group "${newGroupName}" created`, 'success')
        setShowAddGroupModal(false)
        setNewGroupName('')
        setNewGroupDesc('')
        loadGroups(token)
      } else {
        addToast(result.error?.message || 'Failed to create group', 'error')
      }
    } catch {
      addToast('Error creating group', 'error')
    }
  }

  const handleDeleteGroup = async (id: string) => {
    if (!confirm('Delete this group?')) return
    try {
      const res = await fetch(`/api/groups/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const result = await res.json()
      if (result.success) {
        addToast('Group deleted', 'success')
        loadGroups(token)
      }
    } catch {
      addToast('Error deleting group', 'error')
    }
  }

  const handleCreateShare = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!shareModalTarget) return
    try {
      const res = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          path: shareModalTarget.path,
          password: sharePassword.trim() || undefined,
          expiresAt: shareExpiresAt || undefined,
          maxDownloads: shareMaxDownloads ? Number(shareMaxDownloads) : undefined
        })
      })
      const result = await res.json()
      if (result.success) {
        const fullUrl = `${window.location.origin}/api/public/shares/${result.data.token}/download`
        setCreatedShareUrl(fullUrl)
        addToast('Public share link generated!', 'success')
        loadShares(token)
      } else {
        addToast(result.error?.message || 'Failed to create share link', 'error')
      }
    } catch {
      addToast('Error generating share link', 'error')
    }
  }

  const handleRevokeShare = async (id: string) => {
    try {
      const res = await fetch(`/api/shares/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const result = await res.json()
      if (result.success) {
        addToast('Share link revoked', 'success')
        loadShares(token)
      }
    } catch {
      addToast('Error revoking share link', 'error')
    }
  }

  const handleRestoreTrash = async (id: string) => {
    try {
      const res = await fetch('/api/trash/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id })
      })
      const result = await res.json()
      if (result.success) {
        addToast('Item restored to original location', 'success')
        loadTrash(token)
        loadFiles(currentPath)
      } else {
        addToast('Failed to restore item', 'error')
      }
    } catch {
      addToast('Error restoring item', 'error')
    }
  }

  const handleDeleteTrashItem = async (id: string) => {
    if (!confirm('Permanently delete this item?')) return
    try {
      const res = await fetch(`/api/trash/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const result = await res.json()
      if (result.success) {
        addToast('Permanently deleted', 'success')
        loadTrash(token)
      }
    } catch {
      addToast('Error deleting item', 'error')
    }
  }

  const handleClearTrash = async () => {
    if (!confirm('Empty entire trash? This cannot be undone.')) return
    try {
      const res = await fetch('/api/trash', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const result = await res.json()
      if (result.success) {
        addToast('Trash emptied', 'success')
        loadTrash(token)
      }
    } catch {
      addToast('Error emptying trash', 'error')
    }
  }

  useEffect(() => {
    if (token) {
      if (activeView === 'files') loadFiles(currentPath, token)
      if (user?.role === 'admin') loadTrash(token)
      if (activeView === 'admin' && user?.role === 'admin') {
        loadUsers(token)
        loadAuditLogs(token)
        loadShares(token)
        loadGroups(token)
      }
    }
  }, [token, currentPath, activeView, user?.role])

  // Single / Batch File Drop Handler with XHR progress
  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return

    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < acceptedFiles.length; i++) {
      const file = acceptedFiles[i]
      const relPath = file.webkitRelativePath || file.name
      const targetQuery = currentPath === '/uploads' ? relPath : `${currentPath.replace(/^\/uploads\/?/, '')}/${relPath}`
      const b64Path = btoa(unescape(encodeURIComponent(targetQuery)))

      const ok = await new Promise<boolean>((resolve) => {
        const xhr = new XMLHttpRequest()
        const formData = new FormData()
        formData.append('file', file)

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100)
            setUploadProgress({ active: true, percent, filename: `${i + 1}/${acceptedFiles.length}: ${file.name}` })
          }
        }

        xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
        xhr.onerror = () => resolve(false)
        xhr.open('POST', `/api/files/upload?pathBase64=${b64Path}`)
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.send(formData)
      })

      if (ok) successCount++
      else errorCount++
    }

    setUploadProgress(null)

    if (successCount > 0 && errorCount === 0) {
      addToast(`Successfully uploaded ${successCount} file(s)`, 'success')
    } else {
      addToast(`Upload complete: ${successCount} succeeded, ${errorCount} failed`, errorCount > 0 ? 'error' : 'success')
    }

    if (successCount > 0) {
      loadFiles(currentPath)
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop })

  // Folder Upload Handler
  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return

    const fileArray = Array.from(fileList)
    setIsUploadingFolder(true)
    setFolderUploadStatus(`Uploading folder (${fileArray.length} items)...`)

    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]
      const formData = new FormData()
      formData.append('file', file)

      const relPath = file.webkitRelativePath || file.name
      const targetQuery = currentPath === '/uploads' ? relPath : `${currentPath.replace(/^\/uploads\/?/, '')}/${relPath}`

      setFolderUploadStatus(`Uploading file ${i + 1}/${fileArray.length}: ${file.name}`)

      try {
        const b64Path = btoa(unescape(encodeURIComponent(targetQuery)))
        const response = await fetch(`/api/files/upload?pathBase64=${b64Path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        })

        if (response.status === 401) {
          handleLogout()
          addToast('Your session has expired. Please log in again.', 'error')
          setIsUploadingFolder(false)
          return
        }

        const result = await response.json()
        if (result.success) successCount++
        else errorCount++
      } catch {
        errorCount++
      }
    }

    setIsUploadingFolder(false)
    setFolderUploadStatus('')
    addToast(`Folder upload complete: ${successCount} files uploaded successfully (${errorCount} failed)`, errorCount > 0 ? 'error' : 'success')
    loadFiles(currentPath)

    if (folderInputRef.current) {
      folderInputRef.current.value = ''
    }
  }

  // Login Handler
  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const username = formData.get('username') as string
    const password = formData.get('password') as string

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const result = await response.json()
      if (result.success) {
        const newToken = result.data.token
        const loggedInUser = result.data.user
        localStorage.setItem('ar-web-token', newToken)
        localStorage.setItem('ar-web-user', JSON.stringify(loggedInUser))
        setToken(newToken)
        setUser(loggedInUser)
        setIsAuthenticated(true)
        await loadFiles('/uploads', newToken)
        if (loggedInUser.role === 'admin') {
          await loadUsers(newToken)
        }
        addToast(`Welcome back, ${loggedInUser.username}!`, 'success')
      } else {
        addToast('Login failed: ' + (result.error?.message || 'Invalid credentials'), 'error')
      }
    } catch (error) {
      console.error('Login error:', error)
      addToast('Login error: ' + error, 'error')
    }
  }

  // Create User Handler (Admin Console)
  const handleCreateUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!userFormData.username || !userFormData.email || !userFormData.password) {
      addToast('Please fill in all fields', 'error')
      return
    }

    setIsCreatingUser(true)
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userFormData),
      })

      const result = await response.json()
      if (result.success) {
        setShowAddUserModal(false)
        setUserFormData({ username: '', email: '', password: '', role: 'user' })
        await loadUsers(token)
        addToast('User created successfully!', 'success')
      } else {
        addToast(`Error: ${result.error?.message || 'Failed to create user'}`, 'error')
      }
    } catch (error) {
      console.error('Create user error:', error)
      addToast('Failed to create user', 'error')
    } finally {
      setIsCreatingUser(false)
    }
  }

  // Delete User Handler (Admin Console)
  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return

    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      const result = await response.json()
      if (result.success) {
        await loadUsers(token)
        addToast('User deleted successfully!', 'success')
      }
    } catch (error) {
      console.error('Delete user error:', error)
      addToast('Failed to delete user', 'error')
    }
  }

  // Change User Password Handler (Admin Console)
  const handleChangePassword = async (userId: string, username: string) => {
    const newPassword = prompt(`Enter new password for ${username}:`)
    if (!newPassword) return

    if (newPassword.length < 4) {
      addToast('Password must be at least 4 characters long', 'error')
      return
    }

    try {
      const response = await fetch(`/api/users/${userId}/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ password: newPassword }),
      })

      const result = await response.json()
      if (result.success) {
        addToast('Password updated successfully!', 'success')
      } else {
        addToast(result.error?.message || 'Failed to update password', 'error')
      }
    } catch (error) {
      console.error('Update password error:', error)
      addToast('Failed to update password', 'error')
    }
  }

  // File Download Handler
  const handleDownload = async (path: string, name: string) => {
    try {
      const response = await fetch(`/api/files/download?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download error:', error)
    }
  }

  const handleDownloadZip = async (path: string, name: string) => {
    try {
      const response = await fetch(`/api/files/download-zip?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}.zip`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download ZIP error:', error)
    }
  }

  // Single Item Delete Handler
  const handleDelete = async (path: string) => {
    if (!confirm(`Are you sure you want to delete ${path}?`)) return

    try {
      const response = await fetch('/api/files', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path }),
      })

      if (response.status === 401) {
        handleLogout()
        addToast('Your session has expired. Please log in again.', 'error')
        return
      }

      const result = await response.json()
      if (result.success) {
        addToast('Item deleted successfully', 'success')
        await loadFiles(currentPath)
        loadTrash(token)
      } else {
        addToast(`Error deleting item: ${result.error?.message || 'Unknown error'}`, 'error')
      }
    } catch (error) {
      console.error('Delete error:', error)
      addToast('Failed to delete item', 'error')
    }
  }

  // Bulk Delete Handler
  const handleBulkDelete = async () => {
    if (selectedFiles.length === 0) return
    if (!confirm(`Are you sure you want to delete ${selectedFiles.length} selected item(s)?`)) return

    try {
      const response = await fetch('/api/files/bulk', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ paths: selectedFiles }),
      })

      if (response.status === 401) {
        handleLogout()
        addToast('Your session has expired. Please log in again.', 'error')
        return
      }

      const result = await response.json()
      if (result.success) {
        const { succeeded, failed } = result.data
        addToast(`Bulk delete complete: ${succeeded.length} succeeded, ${failed.length} failed`, failed.length > 0 ? 'warning' : 'success')
        loadFiles(currentPath)
        loadTrash(token)
      } else {
        const errMsg = typeof result.error === 'string' ? result.error : (result.error?.message || result.message || 'Unknown error')
        addToast(`Error during bulk delete: ${errMsg}`, 'error')
      }
    } catch (error) {
      console.error('Bulk delete error:', error)
      addToast('Failed to perform bulk delete', 'error')
    }

    setSelectedFiles([])
    await loadFiles(currentPath)
  }

  // Select All Checkbox Handler
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedFiles(files.map(f => f.virtualPath))
    } else {
      setSelectedFiles([])
    }
  }

  // Logout Handler
  const handleLogout = () => {
    localStorage.removeItem('ar-web-token')
    localStorage.removeItem('ar-web-user')
    setToken('')
    setUser(null)
    setIsAuthenticated(false)
    setFiles([])
    setSelectedFiles([])
    setActiveView('files')
  }

  // Calculate Breadcrumb parts
  const getBreadcrumbs = () => {
    const parts = currentPath.split('/').filter(Boolean)
    const crumbs = []
    let accumulated = ''
    for (let i = 0; i < parts.length; i++) {
      accumulated += '/' + parts[i]
      crumbs.push({ name: parts[i], path: accumulated })
    }
    return crumbs
  }

  const totalStorageBytes = files.reduce((acc, f) => acc + (f.size || 0), 0)

  if (!isAuthenticated) {
    return (
      <div className="login-wrapper">
        <div className="ambient-glow-primary" />
        <div className="login-card">
          <div className="brand-section" style={{ marginBottom: '1.25rem' }}>
            <div className="brand-icon">📁</div>
            <div>
              <h1 className="brand-title">AR File Hub</h1>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cloud File Manager Console</p>
            </div>
          </div>

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                name="username"
                type="text"
                placeholder="Enter username"
                required
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                name="password"
                type="password"
                placeholder="••••••••"
                required
                className="form-input"
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.75rem', justifyContent: 'center' }}>
              Sign In
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      <div className="ambient-glow-primary" />
      <div className="ambient-glow-secondary" />

      {/* Top Navbar */}
      <header className="app-navbar">
        <div className="brand-section">
          <div className="brand-icon">📁</div>
          <div className="brand-title">
            AR File Hub <span className="brand-badge">v1.0</span>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="nav-views-switcher">
          <button
            onClick={() => setActiveView('files')}
            className={`nav-view-btn ${activeView === 'files' ? 'active' : ''}`}
          >
            📁 File Hub
          </button>
          {user?.role === 'admin' && (
            <button
              onClick={() => setActiveView('trash')}
              className={`nav-view-btn ${activeView === 'trash' ? 'active' : ''}`}
            >
              🗑️ Trash ({trashItems.length})
            </button>
          )}
          {user?.role === 'admin' && (
            <button
              onClick={() => setActiveView('admin')}
              className={`nav-view-btn ${activeView === 'admin' ? 'active' : ''}`}
            >
              🛡️ Admin Console
            </button>
          )}
        </div>

        <div className="navbar-right">
          <button
            onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            className="btn btn-secondary"
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.8125rem' }}
            title="Toggle Theme"
          >
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
          <div className="status-indicator">
            <span className="status-dot" />
            <span>Connected ({user?.username})</span>
          </div>
          <button onClick={handleLogout} className="btn btn-danger">
            Logout
          </button>
        </div>
      </header>

      {/* File Hub View */}
      {activeView === 'files' && (
        <div className="dashboard-grid">
          {/* Left Sidebar */}
          <aside className="sidebar-panel">
            <div className="sidebar-card">
              <div className="sidebar-card-title">Storage Summary</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {formatBytes(totalStorageBytes)}
              </div>
              <div className="storage-progress-bg">
                <div className="storage-progress-fill" style={{ width: '15%' }} />
              </div>
              <div className="storage-stats-text">
                <span>{files.length} items in folder</span>
                <span>Local Mount</span>
              </div>
            </div>

            <div className="sidebar-card">
              <div className="sidebar-card-title">Quick Views</div>
              <button className={`sidebar-nav-item ${activeView === 'files' ? 'active' : ''}`} onClick={() => setActiveView('files')}>
                <span>📂</span> All Uploads
              </button>
              {user?.role === 'admin' && (
                <button className={`sidebar-nav-item ${activeView === 'trash' ? 'active' : ''}`} onClick={() => setActiveView('trash')}>
                  <span>🗑️</span> Trash ({trashItems.length})
                </button>
              )}
            </div>
          </aside>

          {/* Main Explorer Column */}
          <main className="main-explorer">
            {/* Upload Card */}
            <div className="upload-card">
              <div className="upload-tabs">
                <button
                  onClick={() => setUploadMode('file')}
                  className={`tab-btn ${uploadMode === 'file' ? 'active' : ''}`}
                >
                  📄 Single / Batch Files
                </button>
                <button
                  onClick={() => setUploadMode('folder')}
                  className={`tab-btn ${uploadMode === 'folder' ? 'active' : ''}`}
                >
                  📁 Whole Folder
                </button>
              </div>

              {/* Hidden Folder Picker Input */}
              <input
                type="file"
                ref={folderInputRef}
                style={{ display: 'none' }}
                {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
                onChange={handleFolderUpload}
              />

              {uploadMode === 'file' ? (
                <div
                  {...getRootProps()}
                  className={`dropzone-box ${isDragActive ? 'active' : ''}`}
                >
                  <input {...getInputProps()} />
                  <div className="drop-icon">☁️</div>
                  {isDragActive ? (
                    <p className="drop-title">Release to upload files</p>
                  ) : (
                    <>
                      <p className="drop-title">Drag & drop files here, or click to browse</p>
                      <p className="drop-sub">Upload single or multiple files directly to current folder</p>
                    </>
                  )}
                </div>
              ) : (
                <div
                  className="dropzone-box folder"
                  onClick={() => folderInputRef.current?.click()}
                >
                  <div className="drop-icon">📁</div>
                  <p className="drop-title">Click to Select Folder & Subdirectories</p>
                  <p className="drop-sub">Uploads full directory hierarchy recursively</p>
                  {isUploadingFolder && (
                    <div className="upload-progress-box">
                      <span>⏳</span>
                      <span>{folderUploadStatus}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Breadcrumbs Card */}
            <div className="breadcrumbs-card">
              <button 
                className="back-button"
                onClick={() => handleNavigate(currentPath.split('/').slice(0, -1).join('/') || '/uploads')}
                disabled={currentPath === '/uploads'}
                style={{ opacity: currentPath === '/uploads' ? 0.5 : 1 }}
              >
                ← Back
              </button>
              <span className="crumb-item" onClick={() => handleNavigate('/uploads')}>
                Root (/uploads)
              </span>
              {getBreadcrumbs().slice(1).map((crumb) => (
                <React.Fragment key={crumb.path}>
                  <span className="crumb-sep">/</span>
                  <span className="crumb-item" onClick={() => handleNavigate(crumb.path)}>
                    {crumb.name}
                  </span>
                </React.Fragment>
              ))}
            </div>

            {/* File Explorer Table */}
            <div className="explorer-card">
              <div className="toolbar" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
                <div className="category-tabs">
                  {(['All', 'Images', 'Videos', 'Archive', 'Folders', 'Documents'] as Category[]).map(cat => (
                    <button
                      key={cat}
                      className={`category-tab ${activeCategory === cat ? 'active' : ''}`}
                      onClick={() => handleCategoryChange(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="search-input-wrapper">
                  <span className="search-icon-inside">🔍</span>
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Search in folder..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <button onClick={() => setShowNewFolderModal(true)} className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem' }}>
                    + New Folder
                  </button>
                  {selectedFiles.length > 0 && (
                    <>
                      <button onClick={() => { setClipboard({ mode: 'cut', paths: selectedFiles }); addToast(`${selectedFiles.length} item(s) cut to clipboard`, 'info') }} className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem' }}>
                        ✂️ Cut
                      </button>
                      <button onClick={() => { setClipboard({ mode: 'copy', paths: selectedFiles }); addToast(`${selectedFiles.length} item(s) copied to clipboard`, 'info') }} className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem' }}>
                        📋 Copy
                      </button>
                    </>
                  )}
                  {clipboard && (
                    <button onClick={handlePaste} className="btn btn-primary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem' }}>
                      📋 Paste ({clipboard.paths.length})
                    </button>
                  )}
                </div>

                <div className="view-toggles">
                  <button 
                    className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                    onClick={() => setViewMode('list')}
                    title="List View"
                  >
                    ☰
                  </button>
                  <button 
                    className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                    onClick={() => setViewMode('grid')}
                    title="Grid View"
                  >
                    ⊞
                  </button>
                </div>
              </div>

              <div className="card-header-bar">
                <div className="card-header-title">
                  <span>Directory Items</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '0.15rem 0.5rem', borderRadius: '9999px', border: '1px solid var(--border-color)' }}>
                    {filteredFiles.length}
                  </span>
                </div>
              </div>

              {selectedFiles.length > 0 && (
                <div className="bulk-actions-bar">
                  <span>{selectedFiles.length} item(s) selected</span>
                  {user?.role === 'admin' ? (
                    <button onClick={handleBulkDelete} className="btn btn-danger">
                      Delete Selected
                    </button>
                  ) : (
                    <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>Admin permissions required to delete</span>
                  )}
                </div>
              )}

              {filteredFiles.length > 0 && viewMode === 'list' && (
                <div className="table-controls-row">
                  <input
                    type="checkbox"
                    id="select-all"
                    checked={selectedFiles.length === filteredFiles.length && filteredFiles.length > 0}
                    onChange={handleSelectAll}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <label htmlFor="select-all" style={{ cursor: 'pointer', fontWeight: 600 }}>
                    Select All
                  </label>
                </div>
              )}

              {filteredFiles.length === 0 ? (
                <div className="empty-state">
                  <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</p>
                  <p style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>No items found in this category</p>
                  <p style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>Change category or upload new files.</p>
                </div>
              ) : viewMode === 'grid' ? (
                <div className="file-grid">
                  {filteredFiles.map((file) => {
                    const isSelected = selectedFiles.includes(file.virtualPath)
                    const isDirectory = file.type === 'directory'
                    const icon = getFileIcon(file.name, isDirectory)
                    return (
                      <div key={file.id} className={`file-grid-item ${isSelected ? 'selected' : ''}`} onClick={() => isDirectory ? null : handlePreview(file)} onDoubleClick={() => isDirectory ? handleNavigate(file.virtualPath) : null}>
                        <div className="checkbox-wrapper">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedFiles(prev => [...prev, file.virtualPath])
                              else setSelectedFiles(prev => prev.filter(id => id !== file.virtualPath))
                            }}
                            style={{ width: 16, height: 16, cursor: 'pointer' }}
                          />
                        </div>
                        <div className="actions-wrapper">
                          <button onClick={(e) => { e.stopPropagation(); setShareModalTarget({ path: file.virtualPath, name: file.name }); setCreatedShareUrl(''); setSharePassword(''); setShareExpiresAt(''); setShareMaxDownloads(''); }} className="btn btn-secondary" title="Share">
                            🔗
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setRenameTarget({ path: file.virtualPath, name: file.name }); setRenameNewName(file.name); }} className="btn btn-secondary" title="Rename">
                            ✏️
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); isDirectory ? handleDownloadZip(file.virtualPath, file.name) : handleDownload(file.virtualPath, file.name); }} className="btn btn-secondary" title={isDirectory ? "Download Zip" : "Download"}>
                            {isDirectory ? '📦' : '⬇️'}
                          </button>
                          {user?.role === 'admin' && (
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(file.virtualPath); }} className="btn btn-danger" title="Delete">
                              🗑️
                            </button>
                          )}
                        </div>
                        <div className="file-icon-large" onClick={() => isDirectory ? handleNavigate(file.virtualPath) : null}>{icon}</div>
                        <div className="file-name-text" title={file.name}>{file.name}</div>
                        <div className="file-size-text">{isDirectory ? 'Folder' : formatBytes(file.size || 0)}</div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div>
                  {filteredFiles.map((file) => {
                    const isSelected = selectedFiles.includes(file.virtualPath)
                    const isDirectory = file.type === 'directory'
                    const icon = getFileIcon(file.name, isDirectory)
                    return (
                      <div key={file.id} className={`file-row ${isSelected ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedFiles((prev) => [...prev, file.virtualPath])
                            } else {
                              setSelectedFiles((prev) => prev.filter((id) => id !== file.virtualPath))
                            }
                          }}
                          style={{ width: 16, height: 16, cursor: 'pointer' }}
                        />
                        <div className="file-name-cell">
                          <span style={{ fontSize: '1.2rem' }}>{icon}</span>
                          {isDirectory ? (
                            <span
                              className="file-name-text folder-click"
                              onClick={() => handleNavigate(file.virtualPath)}
                            >
                              {file.name}/
                            </span>
                          ) : (
                            <span className="file-name-text" style={{ cursor: 'pointer' }} onClick={() => handlePreview(file)}>{file.name}</span>
                          )}
                        </div>
                        <div className="file-size-cell">
                          {isDirectory ? 'Folder' : formatBytes(file.size || 0)}
                        </div>
                        <div className="file-actions-cell">
                          <button onClick={() => isDirectory ? handleDownloadZip(file.virtualPath, file.name) : handleDownload(file.virtualPath, file.name)} className="btn btn-secondary">
                            {isDirectory ? '📦 Zip' : '⬇️ Download'}
                          </button>
                          <button onClick={() => { setShareModalTarget({ path: file.virtualPath, name: file.name }); setCreatedShareUrl(''); setSharePassword(''); setShareExpiresAt(''); setShareMaxDownloads(''); }} className="btn btn-secondary">
                            🔗 Share
                          </button>
                          <button onClick={() => { setRenameTarget({ path: file.virtualPath, name: file.name }); setRenameNewName(file.name); }} className="btn btn-secondary">
                            ✏️ Rename
                          </button>
                          {user?.role === 'admin' && (
                            <button onClick={() => handleDelete(file.virtualPath)} className="btn btn-danger">
                              🗑️ Delete
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      {/* Trash View */}
      {activeView === 'trash' && (
        <div className="explorer-card">
          <div className="card-header-bar">
            <div className="card-header-title">
              <span>🗑️ Trash ({trashItems.length} items)</span>
            </div>
            {user?.role === 'admin' && trashItems.length > 0 && (
              <button onClick={handleClearTrash} className="btn btn-danger">
                Empty Trash
              </button>
            )}
          </div>
          <div>
            {trashItems.length === 0 ? (
              <div className="empty-state">
                <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🗑️</p>
                <p style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Trash is empty</p>
              </div>
            ) : (
              <div>
                {trashItems.map((item) => (
                  <div key={item.id} className="file-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1rem' }}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.original_path.split('/').pop()}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Original: {item.original_path} | Deleted by {item.deleted_by} on {new Date(item.deleted_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="file-actions-cell" style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => handleRestoreTrash(item.id)} className="btn btn-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }}>
                        Restore
                      </button>
                      <button onClick={() => handleDeleteTrashItem(item.id)} className="btn btn-danger" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }}>
                        Delete Permanently
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <div className="modal-backdrop" onClick={() => setPreviewFile(null)} style={{ zIndex: 1000, justifyContent: 'flex-end', padding: 0, background: 'rgba(0,0,0,0.2)', backdropFilter: 'none' }}>
          <div className="modal-card" style={{ maxWidth: '90vw', width: '500px', height: '100vh', maxHeight: '100vh', borderRadius: 0, padding: '1.5rem', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }} title={previewFile.name}>{previewFile.name}</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => handleDownload(previewFile.path, previewFile.name)} className="btn btn-primary" style={{ padding: '0.25rem 0.5rem' }}>Download</button>
                <button onClick={() => setPreviewFile(null)} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem' }}>✕</button>
              </div>
            </div>
            <div style={{ width: '100%', flex: 1, display: 'flex', justifyContent: 'center', overflow: 'hidden', background: '#000', borderRadius: '0.5rem' }}>
              {!previewUrl ? (
                <div style={{ display: 'flex', alignItems: 'center', color: '#fff' }}>Loading...</div>
              ) : previewFile.type === 'image' ? (
                <img src={previewUrl} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} alt={previewFile.name} />
              ) : previewFile.type === 'video' ? (
                <video src={previewUrl} controls autoPlay style={{ maxWidth: '100%', maxHeight: '100%' }} />
              ) : (
                <iframe src={previewUrl} style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} title={previewFile.name} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin Console View */}
      {activeView === 'admin' && user?.role === 'admin' && (
        <div className="admin-grid">
          {/* Subtabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <button className={`btn ${adminTab === 'users' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAdminTab('users')}>
              👥 User Management ({users.length})
            </button>
            <button className={`btn ${adminTab === 'groups' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAdminTab('groups')}>
              🏢 Groups ({groups.length})
            </button>
            <button className={`btn ${adminTab === 'shares' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAdminTab('shares')}>
              🔗 Active Shares ({shares.length})
            </button>
            <button className={`btn ${adminTab === 'audit' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAdminTab('audit')}>
              📋 Audit Logs ({auditLogs.length})
            </button>
          </div>

          {/* Stats Section */}
          <div className="stats-grid">
            <div className="stat-card">
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Users</div>
                <div className="stat-val">{users.length}</div>
              </div>
              <div className="stat-icon">👥</div>
            </div>
            <div className="stat-card">
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Public Shares</div>
                <div className="stat-val">{shares.length}</div>
              </div>
              <div className="stat-icon">🔗</div>
            </div>
            <div className="stat-card">
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Audit Logs</div>
                <div className="stat-val">{auditLogs.length}</div>
              </div>
              <div className="stat-icon">📋</div>
            </div>
          </div>

          {/* User Management Section */}
          {adminTab === 'users' && (
            <div className="explorer-card">
              <div className="card-header-bar">
                <div className="card-header-title">
                  <span>User Management</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '0.15rem 0.5rem', borderRadius: '9999px', border: '1px solid var(--border-color)' }}>
                    {users.length} Users
                  </span>
                </div>
                <button onClick={() => setShowAddUserModal(true)} className="btn btn-primary">
                  + Add User
                </button>
              </div>

              <div>
                {users.length === 0 ? (
                  <div className="empty-state">No users registered</div>
                ) : (
                  <div>
                    {users.map((u) => (
                      <div key={u.id} className="admin-user-row">
                        <div className="admin-user-info">
                          <div className="admin-user-username">👤 {u.username}</div>
                          <div className="admin-user-email">{u.email}</div>
                        </div>
                        <div className="admin-user-badges">
                          <span className={`badge-role ${u.role === 'admin' ? 'badge-admin' : 'badge-user'}`}>
                            {u.role.toUpperCase()}
                          </span>
                          <span className="badge-role badge-active">ACTIVE</span>
                        </div>
                        <div className="file-actions-cell" style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={() => handleChangePassword(u.id, u.username)} className="btn btn-secondary">
                            Password
                          </button>
                          <button onClick={() => handleDeleteUser(u.id)} className="btn btn-danger">
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Group Management Section */}
          {adminTab === 'groups' && (
            <div className="explorer-card">
              <div className="card-header-bar">
                <div className="card-header-title">
                  <span>Group Management</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '0.15rem 0.5rem', borderRadius: '9999px', border: '1px solid var(--border-color)' }}>
                    {groups.length} Groups
                  </span>
                </div>
                <button onClick={() => setShowAddGroupModal(true)} className="btn btn-primary">
                  + Create Group
                </button>
              </div>

              <div>
                {groups.length === 0 ? (
                  <div className="empty-state">No groups created yet</div>
                ) : (
                  <div>
                    {groups.map((g) => (
                      <div key={g.id} className="file-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1rem' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>🏢 {g.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{g.description || 'No description'}</div>
                        </div>
                        <div className="file-actions-cell">
                          <button onClick={() => handleDeleteGroup(g.id)} className="btn btn-danger" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }}>
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Active Shares Section */}
          {adminTab === 'shares' && (
            <div className="explorer-card">
              <div className="card-header-bar">
                <div className="card-header-title">
                  <span>Public Shares ({shares.length})</span>
                </div>
              </div>
              <div>
                {shares.length === 0 ? (
                  <div className="empty-state">No public shares generated yet</div>
                ) : (
                  <div>
                    {shares.map((share) => (
                      <div key={share.id} className="file-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1rem' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>🔗 {share.virtual_path}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Downloads: {share.download_count} {share.max_downloads ? `/ ${share.max_downloads}` : ''} | Created by {share.created_by}
                          </div>
                        </div>
                        <div className="file-actions-cell" style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/api/public/shares/${share.token}/download`); addToast('Share link copied to clipboard!', 'info') }} className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }}>
                            Copy Link
                          </button>
                          <button onClick={() => handleRevokeShare(share.id)} className="btn btn-danger" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }}>
                            Revoke
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Audit Logs Section */}
          {adminTab === 'audit' && (
            <div className="explorer-card">
              <div className="card-header-bar">
                <div className="card-header-title">
                  <span>System Audit Logs</span>
                </div>
              </div>
              <div>
                {auditLogs.length === 0 ? (
                  <div className="empty-state">No audit logs recorded yet</div>
                ) : (
                  <div>
                    {auditLogs.map((log) => (
                      <div key={log.id} className="file-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem' }}>
                        <div>
                          <span style={{ fontWeight: 700, color: 'var(--accent-indigo)', marginRight: '0.5rem', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            [{log.action}]
                          </span>
                          <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>{log.resource || 'System'}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {new Date(log.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '1rem' }}>Create New User</h2>
            <form onSubmit={handleCreateUser}>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input
                  type="text"
                  value={userFormData.username}
                  onChange={(e) => setUserFormData({ ...userFormData, username: e.target.value })}
                  placeholder="john_doe"
                  required
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  value={userFormData.email}
                  onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                  placeholder="john@example.com"
                  required
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  value={userFormData.password}
                  onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                  placeholder="••••••••"
                  required
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select
                  value={userFormData.role}
                  onChange={(e) => setUserFormData({ ...userFormData, role: e.target.value as any })}
                  className="form-input"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option value="guest">Guest</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifySelf: 'flex-end', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                <button type="button" onClick={() => setShowAddUserModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={isCreatingUser} className="btn btn-primary">
                  {isCreatingUser ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="modal-backdrop" onClick={() => setShowNewFolderModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '1rem' }}>Create New Folder</h2>
            <form onSubmit={handleCreateFolder}>
              <div className="form-group">
                <label className="form-label">Folder Name</label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="e.g. Documents, Projects"
                  required
                  autoFocus
                  className="form-input"
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                <button type="button" onClick={() => setShowNewFolderModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div className="modal-backdrop" onClick={() => setRenameTarget(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '1rem' }}>Rename Item</h2>
            <form onSubmit={handleRenameSubmit}>
              <div className="form-group">
                <label className="form-label">New Name</label>
                <input
                  type="text"
                  value={renameNewName}
                  onChange={(e) => setRenameNewName(e.target.value)}
                  required
                  autoFocus
                  className="form-input"
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                <button type="button" onClick={() => setRenameTarget(null)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {shareModalTarget && (
        <div className="modal-backdrop" onClick={() => setShareModalTarget(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>Public Share Link</h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>Sharing: {shareModalTarget.name}</p>

            {createdShareUrl ? (
              <div>
                <div className="form-group">
                  <label className="form-label">Share Link</label>
                  <input
                    type="text"
                    readOnly
                    value={createdShareUrl}
                    className="form-input"
                    style={{ background: 'rgba(99, 102, 241, 0.1)', borderColor: 'var(--accent-indigo)' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(createdShareUrl)
                      addToast('Share link copied to clipboard!', 'success')
                    }}
                    className="btn btn-primary"
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    📋 Copy Link
                  </button>
                  <button onClick={() => setShareModalTarget(null)} className="btn btn-secondary">
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateShare}>
                <div className="form-group">
                  <label className="form-label">Password Protection (Optional)</label>
                  <input
                    type="password"
                    value={sharePassword}
                    onChange={(e) => setSharePassword(e.target.value)}
                    placeholder="Set optional access password"
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Expiration Date (Optional)</label>
                  <input
                    type="datetime-local"
                    value={shareExpiresAt}
                    onChange={(e) => setShareExpiresAt(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Max Downloads Limit (Optional)</label>
                  <input
                    type="number"
                    value={shareMaxDownloads}
                    onChange={(e) => setShareMaxDownloads(e.target.value)}
                    placeholder="e.g. 5"
                    className="form-input"
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                  <button type="button" onClick={() => setShareModalTarget(null)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Generate Link
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showAddGroupModal && (
        <div className="modal-backdrop" onClick={() => setShowAddGroupModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '1rem' }}>Create New Group</h2>
            <form onSubmit={handleCreateGroup}>
              <div className="form-group">
                <label className="form-label">Group Name</label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Developers, Design Team"
                  required
                  autoFocus
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description (Optional)</label>
                <input
                  type="text"
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder="Short description of group"
                  className="form-input"
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                <button type="button" onClick={() => setShowAddGroupModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Text Editor Modal */}
      {editFileTarget && (
        <div className="modal-backdrop" onClick={() => setEditFileTarget(null)}>
          <div className="modal-card" style={{ maxWidth: '800px', width: '90vw' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                ✏️ Editing: {editFileTarget.name}
              </h2>
              <button onClick={() => setEditFileTarget(null)} className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem' }}>✕</button>
            </div>
            <textarea
              value={editFileTarget.content}
              onChange={(e) => setEditFileTarget({ ...editFileTarget, content: e.target.value })}
              rows={18}
              className="form-input"
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.875rem',
                lineHeight: '1.5',
                whiteSpace: 'pre',
                tabSize: 2,
                resize: 'vertical'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
              <button type="button" onClick={() => setEditFileTarget(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="button" onClick={handleSaveEditor} disabled={isSavingEdit} className="btn btn-primary">
                {isSavingEdit ? 'Saving...' : '💾 Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast-item ${t.type}`}>
              <span>{t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}</span>
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default App