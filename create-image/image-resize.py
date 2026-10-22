from PIL import Image
import os

def resize_custom(input_path, widths, heights):
    """
    Resize ảnh dựa trên danh sách chiều rộng (widths) và chiều cao (heights) tương ứng.
    """
    try:
        with Image.open(input_path) as img:
            # zip(widths, heights) sẽ ghép cặp: (640, 400), (440, 280), (1400, 560)
            for w, h in zip(widths, heights):
                # Resize theo kích thước cố định (width x height)
                # Lưu ý: Ảnh có thể bị méo nếu tỉ lệ không khớp với ảnh gốc
                resized = img.resize((w, h), Image.Resampling.LANCZOS)
                
                output_file = f"resized_{w}x{h}.png"
                resized.save(output_file, "PNG")
                print(f"Đã lưu: {output_file}")
    except FileNotFoundError:
        print("Lỗi: Không tìm thấy file ảnh đầu vào.")

# Danh sách kích thước
sizes = [640, 440, 1400]   # Widths
sizes2 = [400, 280, 560]   # Heights

resize_custom("maxresdefault.jpg", sizes, sizes2)

# from PIL import Image
# import os

# input_image = "maxresdefault.jpg"

# sizes = [640, 440, 1400]
# sizes2 = [400, 280, 560]

# img = Image.open(input_image)

# for size in sizes:
#     resized = img.resize((size, size), Image.LANCZOS)

#     output_file = f"icon{size}.png"
#     resized.save(output_file)

#     print(f"Đã lưu: {output_file}")

# muốn tạo luôn file .ico cho Chrome Extension:
# from PIL import Image

# img = Image.open("icon.png")

# img.save(
#     "icon.ico",
#     format="ICO",
#     sizes=[(16,16), (48,48), (128,128)]
# )

# print("Đã tạo icon.ico")